import * as THREE from "three";
import { TOTAL_AMPLITUDE, WAVES, waveNumber } from "./waves";

const g = (n: number): string => n.toFixed(6);

/**
 * Vertex shader generated from the shared wave model, so GPU displacement is
 * exactly the CPU height field plus horizontal Gerstner chop. Unrolled per
 * wave (no array constructors) for GLSL ES 1.00 safety.
 */
function buildVertexShader(): string {
  let accum = "";
  for (const w of WAVES) {
    accum += `  {
    float f = ${g(waveNumber(w))} * dot(vec2(${g(w.dirX)}, ${g(w.dirZ)}), p) - ${g(w.omega)} * uTime;
    float s = sin(f);
    float c = cos(f);
    h += ${g(w.amplitude)} * s;
    grad += (${g(w.amplitude * waveNumber(w))} * c) * vec2(${g(w.dirX)}, ${g(w.dirZ)});
    chop += (${g(w.steepness * w.amplitude)} * c) * vec2(${g(w.dirX)}, ${g(w.dirZ)});
  }
`;
  }
  return `uniform float uTime;
uniform sampler2D uDisp;
uniform float uTileLen;
uniform float uDetail;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vCrest;
varying float vViewZ;

void main() {
  vec2 p = position.xz;
  float h = 0.0;
  vec2 grad = vec2(0.0);
  vec2 chop = vec2(0.0);
${accum}  vec2 duv = p / uTileLen;
  vec3 fft = texture2D(uDisp, duv).xyz * uDetail;
  float e = 0.6 / uTileLen;
  float fhx = texture2D(uDisp, duv + vec2(e, 0.0)).y - texture2D(uDisp, duv - vec2(e, 0.0)).y;
  float fhz = texture2D(uDisp, duv + vec2(0.0, e)).y - texture2D(uDisp, duv - vec2(0.0, e)).y;
  grad += vec2(fhx, fhz) / 1.2 * uDetail;
  vec3 displaced = vec3(position.x + chop.x + fft.x, h + fft.y, position.z + chop.y + fft.z);
  vCrest = clamp(h / ${g(TOTAL_AMPLITUDE)} * 0.5 + 0.5, 0.0, 1.0);
  vNormalW = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec4 wp = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = wp.xyz;
  vViewZ = (viewMatrix * wp).z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
}

const FRAGMENT_SHADER = `#include <packing>

varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vCrest;
varying float vViewZ;

uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform sampler2D uReflection;
uniform mat4 uReflMatrix;
uniform sampler2D uRefraction;
uniform sampler2D uDepthMap;
uniform mat4 uSceneMatrix;
uniform float uNear;
uniform float uFar;
uniform vec3 uAbsorb;
uniform float uFoamDepth;
uniform float uRipple;
uniform vec4 uBlobs[4];
uniform float uDebug;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float dist = distance(cameraPosition, vWorldPos);

  vec2 rp = vWorldPos.xz * 1.4 + vec2(uTime * 0.5, -uTime * 0.4);
  float e2 = 0.35;
  float rx = vnoise(rp + vec2(e2, 0.0)) - vnoise(rp - vec2(e2, 0.0));
  float rz = vnoise(rp + vec2(0.0, e2)) - vnoise(rp - vec2(0.0, e2));
  float rf = exp(-dist / 150.0) * uRipple;
  vec3 normal = normalize(vNormalW + vec3(-rx, 0.0, -rz) * rf);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float ndv = max(dot(normal, viewDir), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  vec4 rproj = uReflMatrix * vec4(vWorldPos, 1.0);
  vec2 ruv = rproj.xy / rproj.w + normal.xz * 0.06;
  vec2 edge = smoothstep(0.0, 0.08, ruv) * (1.0 - smoothstep(0.92, 1.0, ruv));
  vec3 refl = mix(uSky, texture2D(uReflection, clamp(ruv, 0.001, 0.999)).rgb, edge.x * edge.y);

  vec4 sproj = uSceneMatrix * vec4(vWorldPos, 1.0);
  vec2 scuv = sproj.xy / sproj.w * 0.5 + 0.5 + normal.xz * 0.05;
  vec2 sc = clamp(scuv, 0.001, 0.999);
  float sceneDepth = texture2D(uDepthMap, sc).x;
  float sceneDist = -perspectiveDepthToViewZ(sceneDepth, uNear, uFar);
  float thickness = max(sceneDist + vViewZ, 0.0);
  vec3 refr = texture2D(uRefraction, sc).rgb;
  vec3 absorb = exp(-uAbsorb * thickness);
  float absorbLum = clamp((absorb.r + absorb.g + absorb.b) / 3.0, 0.0, 1.0);
  vec3 scatter = mix(uShallow, uDeep, clamp(thickness / 6.0, 0.0, 1.0));
  vec3 body = refr * absorb + scatter * (1.0 - absorbLum);

  vec3 halfVec = normalize(uSunDir + viewDir);
  float ndh = max(dot(normal, halfVec), 0.0);
  float spec = pow(ndh, 600.0) * 1.5 + pow(ndh, 60.0) * 0.15;

  float n = vnoise(vWorldPos.xz * 2.5 + vec2(uTime * 0.35, -uTime * 0.22)) * 0.65
    + vnoise(vWorldPos.xz * 6.0 - vec2(uTime * 0.5, uTime * 0.3)) * 0.35;
  float crestFoam = smoothstep(0.88, 0.97, vCrest + (n - 0.5) * 0.25);
  float shoreFoam = 1.0 - smoothstep(0.0, uFoamDepth, thickness + (n - 0.5) * 1.4);
  float foam = max(crestFoam, shoreFoam);

  vec3 col = mix(body, refl, fresnel);

  float blob = 0.0;
  for (int i = 0; i < 4; i++) {
    float d = distance(vWorldPos.xz, uBlobs[i].xy);
    blob += uBlobs[i].w * (1.0 - smoothstep(uBlobs[i].z * 0.4, uBlobs[i].z, d));
  }
  col *= 1.0 - clamp(blob, 0.0, 0.85) * 0.45;

  col += uSunColor * spec;
  col = mix(col, vec3(0.92, 0.95, 0.96), foam * 0.6);
  col = mix(col, uHorizon, smoothstep(80.0, 260.0, dist));

  if (uDebug > 0.5 && uDebug < 1.5) col = refl;
  else if (uDebug > 1.5 && uDebug < 2.5) col = refr;
  else if (uDebug > 2.5 && uDebug < 3.5) col = vec3(clamp(thickness / 8.0, 0.0, 1.0));
  else if (uDebug > 3.5 && uDebug < 4.5) col = vec3(clamp(sceneDist / 120.0, 0.0, 1.0));
  else if (uDebug > 4.5 && uDebug < 5.5) col = vec3(crestFoam, shoreFoam, foam * 0.25);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface WaterUniforms {
  [uniform: string]: THREE.IUniform;
  uTime: { value: number };
  uDisp: { value: THREE.Texture | null };
  uTileLen: { value: number };
  uDetail: { value: number };
  uReflection: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  uRefraction: { value: THREE.Texture | null };
  uDepthMap: { value: THREE.Texture | null };
  uSceneMatrix: { value: THREE.Matrix4 };
  uNear: { value: number };
  uFar: { value: number };
  uAbsorb: { value: THREE.Vector3 };
  uFoamDepth: { value: number };
  uRipple: { value: number };
  uBlobs: { value: THREE.Vector4[] };
  uDebug: { value: number };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uSky: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
}

export function buildWaterMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDisp: { value: null },
    uTileLen: { value: 64 },
    uDetail: { value: 1 },
    uReflection: { value: null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uRefraction: { value: null },
    uDepthMap: { value: null },
    uSceneMatrix: { value: new THREE.Matrix4() },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uAbsorb: { value: new THREE.Vector3(0.32, 0.14, 0.1) },
    uFoamDepth: { value: 1.4 },
    uRipple: { value: 0.6 },
    uDebug: { value: 0 },
    uBlobs: {
      value: [
        new THREE.Vector4(0, 0, 1, 0),
        new THREE.Vector4(0, 0, 1, 0),
        new THREE.Vector4(0, 0, 1, 0),
        new THREE.Vector4(0, 0, 1, 0)
      ]
    },
    uDeep: { value: new THREE.Color(0x06283d) },
    uShallow: { value: new THREE.Color(0x1b6f8f) },
    uSky: { value: new THREE.Color(0x9fc8e8) },
    uSunDir: { value: sunDir.clone().normalize() },
    uSunColor: { value: new THREE.Color(0xfff2dd) },
    uHorizon: { value: new THREE.Color(0xcfe0ee) }
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: buildVertexShader(),
    fragmentShader: FRAGMENT_SHADER
  });
}

/** Exposed for the CPU/GPU agreement test. */
export function getVertexShader(): string {
  return buildVertexShader();
}
