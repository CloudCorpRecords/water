/**
 * Tessendorf-style FFT ocean spectrum (detail layer).
 *
 * The GPU evaluates the time evolution + inverse FFT; this module owns the
 * initial spectrum H0(k) plus pure helpers mirrored by the shaders. CPU FFT
 * reference lives in fft.ts and cross-checks the butterfly math.
 */

export interface SpectrumParams {
  /** Grid resolution; must be a power of two. */
  size: number;
  /** Physical tile length in meters (the spectrum tile repeats every L). */
  tileLength: number;
  /** Wind speed in m/s. */
  windSpeed: number;
  windDirX: number;
  windDirZ: number;
  /** Phillips amplitude scale (calibrated by the bound test). */
  amplitude: number;
  /** Small-wave damping length in meters. */
  smallLength?: number;
  /** k below which energy rolls off (keeps swell on the Gerstner layer). */
  lowCutoff?: number;
  /** k above which energy rolls off (kills sub-mesh aliasing shimmer). */
  highCutoff?: number;
}

export const DEFAULT_SPECTRUM: SpectrumParams = {
  size: 256,
  tileLength: 64,
  windSpeed: 3.7,
  windDirX: 1,
  windDirZ: 0.35,
  // Empirical scale absorbing grid normalization (standard Tessendorf
  // practice: only the spectral SHAPE is physical). Calibrated so CPU IFFT
  // peaks near 0.3 m — see the bound test.
  amplitude: 50000,
  smallLength: 0.001,
  lowCutoff: (2 * Math.PI) / 16,
  highCutoff: Math.PI
};

const GRAVITY = 9.81;

/** Phillips spectrum P(k). Zero at k = 0, wind-aligned, ~1/k^4 decay. */
export function phillips(
  kx: number,
  kz: number,
  windSpeed: number,
  windDirX: number,
  windDirZ: number,
  amplitude: number,
  smallLength = 0.001,
  lowCutoff = 0,
  highCutoff = 0
): number {
  const k = Math.hypot(kx, kz);
  if (k < 1e-6) return 0;
  const bigL = (windSpeed * windSpeed) / GRAVITY;
  const kL = k * bigL;
  const wlen = Math.hypot(windDirX, windDirZ);
  const dot = ((kx * windDirX) / wlen + (kz * windDirZ) / wlen) / k;
  const low = lowCutoff > 0 ? 1 - Math.exp(-((k / lowCutoff) * (k / lowCutoff))) : 1;
  const kh = highCutoff > 0 ? k / highCutoff : 0;
  const high = highCutoff > 0 ? Math.exp(-kh * kh * kh * kh) : 1;
  return (
    (amplitude * Math.exp(-1 / (kL * kL)) * Math.exp(-k * k * smallLength * smallLength)) /
    (k * k * k * k) *
    dot *
    dot *
    low *
    high
  );
}

/** Wavevector of texel (n, m): centered frequency grid. */
export function wavevector(n: number, m: number, size: number, tileLength: number): [number, number] {
  const dk = (2 * Math.PI) / tileLength;
  return [(n - size / 2) * dk, (m - size / 2) * dk];
}

/** Index of the -k texel (involution; 0 maps to itself). */
export function mirrorIndex(i: number, size: number): number {
  return (size - i) % size;
}

/** Deterministic PRNG so the ocean is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(rng: () => number): [number, number] {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

/**
 * Initial spectrum H0 as RGBA float data: [re, im, 0, 1] per texel.
 * H0 = sqrt(P/2) * (gauss + i*gauss).
 */
export function buildH0Data(params: SpectrumParams, seed = 1337): Float32Array {
  const { size, tileLength, windSpeed, windDirX, windDirZ, amplitude, smallLength, lowCutoff, highCutoff } = params;
  const data = new Float32Array(size * size * 4);
  const rng = mulberry32(seed);
  for (let m = 0; m < size; m++) {
    for (let n = 0; n < size; n++) {
      const [kx, kz] = wavevector(n, m, size, tileLength);
      const p = phillips(kx, kz, windSpeed, windDirX, windDirZ, amplitude, smallLength, lowCutoff, highCutoff);
      const [gr, gi] = gaussianPair(rng);
      const s = Math.sqrt(p / 2);
      const o = (m * size + n) * 4;
      data[o] = s * gr;
      data[o + 1] = s * gi;
      data[o + 2] = 0;
      data[o + 3] = 1;
    }
  }
  return data;
}

/**
 * CPU mirror of the GPU evolution shader: H(k,t) component per texel.
 * mode 0/1/2 = Dx/Dy/Dz. Returns interleaved complex pairs.
 */
export function evolveSpectrum(
  h0: Float32Array,
  params: SpectrumParams,
  t: number,
  mode: 0 | 1 | 2
): Float64Array {
  const { size, tileLength } = params;
  const out = new Float64Array(size * size * 2);
  for (let m = 0; m < size; m++) {
    for (let n = 0; n < size; n++) {
      const o = (m * size + n) * 2;
      const [kx, kz] = wavevector(n, m, size, tileLength);
      const k = Math.hypot(kx, kz);
      if (k < 1e-6) continue;
      const h0o = (m * size + n) * 4;
      const mn = mirrorIndex(n, size);
      const mm = mirrorIndex(m, size);
      const h0mo = (mm * size + mn) * 4;
      const omega = Math.sqrt(GRAVITY * k);
      const wt = omega * t;
      const c = Math.cos(wt);
      const s = Math.sin(wt);
      // term1 = h0(k) * e^{iwt}, term2 = conj(h0(-k)) * e^{-iwt}
      const ax = h0[h0o];
      const ay = h0[h0o + 1];
      const bx = h0[h0mo];
      const by = -h0[h0mo + 1];
      const t1x = ax * c - ay * s;
      const t1y = ax * s + ay * c;
      const t2x = bx * c + by * s;
      const t2y = -bx * s + by * c;
      const hx = t1x + t2x;
      const hy = t1y + t2y;
      if (mode === 1) {
        out[o] = hx;
        out[o + 1] = hy;
      } else {
        const kk = mode === 0 ? kx / k : kz / k;
        // -i * (kk) * H ; -i*(x+iy) = (y, -x)
        out[o] = hy * kk;
        out[o + 1] = -hx * kk;
      }
    }
  }
  return out;
}
