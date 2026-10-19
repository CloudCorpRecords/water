import * as THREE from "three";
import { DEFAULT_SPECTRUM, buildH0Data, type SpectrumParams } from "./spectrum";

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** H(k,t) per texel. Mirrors evolveSpectrum() in spectrum.ts. */
const EVOLVE_FRAG = /* glsl */ `
uniform sampler2D uH0;
uniform float uSize;
uniform float uLen;
uniform float uTime;
uniform float uMode;
vec2 cmult(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 fc = gl_FragCoord.xy - 0.5;
  float dk = 6.28318530718 / uLen;
  float kx = (fc.x - uSize * 0.5) * dk;
  float kz = (fc.y - uSize * 0.5) * dk;
  float k = length(vec2(kx, kz));
  vec2 h = vec2(0.0);
  if (k > 0.000001) {
    vec2 h0k = texture2D(uH0, (fc + 0.5) / uSize).rg;
    vec2 mfc = vec2(mod(uSize - fc.x, uSize), mod(uSize - fc.y, uSize));
    vec2 h0m = texture2D(uH0, (mfc + 0.5) / uSize).rg;
    float wt = sqrt(9.81 * k) * uTime;
    vec2 e1 = vec2(cos(wt), sin(wt));
    vec2 e2 = vec2(cos(wt), -sin(wt));
    vec2 h0mc = vec2(h0m.x, -h0m.y);
    vec2 H = cmult(h0k, e1) + cmult(h0mc, e2);
    if (uMode < 0.5) {
      h = vec2(H.y, -H.x) * (kx / k);
    } else if (uMode < 1.5) {
      h = H;
    } else {
      h = vec2(H.y, -H.x) * (kz / k);
    }
  }
  gl_FragColor = vec4(h, 0.0, 1.0);
}
`;

/** 2D bit-reversal copy. Mirrors the CPU pre-pass in fft.ts. */
const UNSHUFFLE_FRAG = /* glsl */ `
uniform sampler2D uData;
uniform float uSize;
uniform float uStages;
float bitrev(float i) {
  float r = 0.0;
  for (float b = 0.0; b < 12.0; b += 1.0) {
    if (b >= uStages) break;
    r = r * 2.0 + mod(floor(i / exp2(b)), 2.0);
  }
  return r;
}
void main() {
  vec2 fc = gl_FragCoord.xy - 0.5;
  vec2 src = vec2(bitrev(fc.x), bitrev(fc.y));
  gl_FragColor = vec4(texture2D(uData, (src + 0.5) / uSize).rg, 0.0, 1.0);
}
`;

/** One DIT stage. Mirrors ditInverse() in fft.ts (output-centric form). */
const FFT_FRAG = /* glsl */ `
uniform sampler2D uData;
uniform float uSize;
uniform float uStage;
uniform float uVertical;
uniform float uNorm;
vec2 cmult(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 fetchTex(float along, float other) {
  vec2 fc = (uVertical < 0.5)
    ? vec2(along + 0.5, other + 0.5) / uSize
    : vec2(other + 0.5, along + 0.5) / uSize;
  return texture2D(uData, fc).rg;
}
void main() {
  vec2 fc = gl_FragCoord.xy - 0.5;
  float i = (uVertical < 0.5) ? fc.x : fc.y;
  float o = (uVertical < 0.5) ? fc.y : fc.x;
  float block = exp2(uStage);
  float halfBlock = block * 0.5;
  float b = floor(i / block);
  float r = i - b * block;
  float upper = step(r, halfBlock - 0.5);
  float j = mix(r - halfBlock, r, upper);
  float base = b * block;
  float ang = 6.28318530718 * j / block;
  vec2 w = vec2(cos(ang), sin(ang));
  vec2 a = fetchTex(base + j, o);
  vec2 bb = fetchTex(base + j + halfBlock, o);
  vec2 wbb = cmult(w, bb);
  vec2 outc = mix(a - wbb, a + wbb, upper) * uNorm;
  gl_FragColor = vec4(outc, 0.0, 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
uniform sampler2D uData;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uData, vUv).rg, 0.0, 1.0);
}
`;

const COMBINE_FRAG = /* glsl */ `
uniform sampler2D uDx;
uniform sampler2D uDy;
uniform sampler2D uDz;
varying vec2 vUv;
void main() {
  float dx = texture2D(uDx, vUv).r;
  float dy = texture2D(uDy, vUv).r;
  float dz = texture2D(uDz, vUv).r;
  gl_FragColor = vec4(dx, dy, dz, 1.0);
}
`;

function computeTarget(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false
  });
}

/**
 * GPU FFT ocean detail layer: per frame, evolves the Phillips spectrum and
 * inverse-FFTs the Dx/Dy/Dz displacement spectra into a combined texture the
 * water vertex shader samples. 58 passes/frame at 256x256 — trivial load.
 */
export class OceanFFT {
  /** Combined displacement texture (Dx, Dy, Dz). Sample with worldXZ / tileLength. */
  readonly texture: THREE.Texture;
  readonly size: number;
  readonly tileLength: number;

  private renderer: THREE.WebGLRenderer;
  private stages: number;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private evoMat: THREE.ShaderMaterial;
  private unshuffleMat: THREE.ShaderMaterial;
  private fftMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial;
  private combineMat: THREE.ShaderMaterial;
  private ping: THREE.WebGLRenderTarget;
  private pong: THREE.WebGLRenderTarget;
  private results: THREE.WebGLRenderTarget[];
  private combined: THREE.WebGLRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, params: SpectrumParams = DEFAULT_SPECTRUM, seed = 1337) {
    this.renderer = renderer;
    this.size = params.size;
    this.tileLength = params.tileLength;
    this.stages = Math.log2(params.size);
    if (!Number.isInteger(this.stages)) throw new Error("spectrum size must be a power of two");

    const h0 = new THREE.DataTexture(buildH0Data(params, seed), params.size, params.size, THREE.RGBAFormat, THREE.FloatType);
    h0.minFilter = THREE.NearestFilter;
    h0.magFilter = THREE.NearestFilter;
    h0.needsUpdate = true;

    const { size } = this;
    this.evoMat = new THREE.ShaderMaterial({
      uniforms: {
        uH0: { value: h0 },
        uSize: { value: size },
        uLen: { value: params.tileLength },
        uTime: { value: 0 },
        uMode: { value: 0 }
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: EVOLVE_FRAG
    });
    this.unshuffleMat = new THREE.ShaderMaterial({
      uniforms: { uData: { value: null }, uSize: { value: size }, uStages: { value: this.stages } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: UNSHUFFLE_FRAG
    });
    this.fftMat = new THREE.ShaderMaterial({
      uniforms: {
        uData: { value: null },
        uSize: { value: size },
        uStage: { value: 1 },
        uVertical: { value: 0 },
        uNorm: { value: 1 }
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FFT_FRAG
    });
    this.blitMat = new THREE.ShaderMaterial({
      uniforms: { uData: { value: null } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLIT_FRAG
    });
    this.combineMat = new THREE.ShaderMaterial({
      uniforms: { uDx: { value: null }, uDy: { value: null }, uDz: { value: null } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMBINE_FRAG
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.evoMat);
    this.scene.add(this.quad);

    this.ping = computeTarget(size);
    this.pong = computeTarget(size);
    this.results = [computeTarget(size), computeTarget(size), computeTarget(size)];
    this.combined = computeTarget(size);
    this.combined.texture.minFilter = THREE.LinearFilter;
    this.combined.texture.magFilter = THREE.LinearFilter;
    this.combined.texture.wrapS = THREE.RepeatWrapping;
    this.combined.texture.wrapT = THREE.RepeatWrapping;
    this.texture = this.combined.texture;
  }

  private run(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  update(time: number): void {
    const prevTarget = this.renderer.getRenderTarget();
    let src = this.ping;
    let dst = this.pong;
    const swap = (): void => {
      const tmp = src;
      src = dst;
      dst = tmp;
    };
    for (let mode = 0; mode < 3; mode++) {
      this.evoMat.uniforms.uTime.value = time;
      this.evoMat.uniforms.uMode.value = mode;
      this.run(this.evoMat, src);
      this.unshuffleMat.uniforms.uData.value = src.texture;
      this.run(this.unshuffleMat, dst);
      swap();
      for (let s = 1; s <= this.stages; s++) {
        this.fftMat.uniforms.uData.value = src.texture;
        this.fftMat.uniforms.uStage.value = s;
        this.fftMat.uniforms.uVertical.value = 0;
        this.fftMat.uniforms.uNorm.value = 1;
        this.run(this.fftMat, dst);
        swap();
      }
      for (let s = 1; s <= this.stages; s++) {
        this.fftMat.uniforms.uData.value = src.texture;
        this.fftMat.uniforms.uStage.value = s;
        this.fftMat.uniforms.uVertical.value = 1;
        this.fftMat.uniforms.uNorm.value = s === this.stages ? 1 / (this.size * this.size) : 1;
        this.run(this.fftMat, dst);
        swap();
      }
      this.blitMat.uniforms.uData.value = src.texture;
      this.run(this.blitMat, this.results[mode]);
    }
    this.combineMat.uniforms.uDx.value = this.results[0].texture;
    this.combineMat.uniforms.uDy.value = this.results[1].texture;
    this.combineMat.uniforms.uDz.value = this.results[2].texture;
    this.run(this.combineMat, this.combined);
    this.renderer.setRenderTarget(prevTarget);
  }
}
