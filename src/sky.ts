import * as THREE from "three";

/**
 * Gradient sky dome with sun disc + glow. Drawn at far depth so the ocean
 * and floaters always overdraw it. Shares the sun direction vector by
 * reference with the water material.
 */
export function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(600, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDir },
      uZenith: { value: new THREE.Color(0x2f6fb4) },
      uHorizon: { value: new THREE.Color(0xcfe0ee) },
      uGround: { value: new THREE.Color(0x1c303f) },
      uSunColor: { value: new THREE.Color(0xfff2dd) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSunDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunColor;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col;
        if (d.y >= 0.0) {
          col = mix(uHorizon, uZenith, pow(d.y, 0.55));
        } else {
          col = mix(uHorizon, uGround, pow(clamp(-d.y * 3.0, 0.0, 1.0), 0.7));
        }
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (smoothstep(0.9992, 0.9997, s) * 3.0 + pow(s, 350.0) * 0.6 + pow(s, 8.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
