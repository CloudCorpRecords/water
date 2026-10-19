import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECTRUM,
  buildH0Data,
  evolveSpectrum,
  mirrorIndex,
  phillips
} from "../src/spectrum";
import { bitReverse, dftForwardNaive, ifft1D, ifft2D } from "../src/fft";

function randomComplex(n: number, seed: number): Float64Array {
  let a = seed >>> 0;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) {
    a = (Math.imul(a ^ (a >>> 15), 1 | a) + 0x6d2b79f5) | 0;
    out[i] = ((a ^ (a >>> 14)) >>> 0) / 4294967296 - 0.5;
  }
  return out;
}

function maxAbsDiff(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("ifft1D", () => {
  it("inverts naive DFT", () => {
    const x = randomComplex(8, 42);
    expect(maxAbsDiff(x, ifft1D(dftForwardNaive(x)))).toBeLessThan(1e-9);
  });

  it("bit-reverses correctly", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => bitReverse(i, 3))).toEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });

  it("round-trips 2D through ifft2D", () => {
    const n = 8;
    const x = randomComplex(n * n, 7);
    // Forward 2D via naive rows+cols.
    const row = new Float64Array(n * 2);
    const fwd = new Float64Array(x.length);
    for (let m = 0; m < n; m++) {
      for (let i = 0; i < n; i++) {
        row[2 * i] = x[(m * n + i) * 2];
        row[2 * i + 1] = x[(m * n + i) * 2 + 1];
      }
      const r = dftForwardNaive(row);
      for (let i = 0; i < n; i++) {
        fwd[(m * n + i) * 2] = r[2 * i];
        fwd[(m * n + i) * 2 + 1] = r[2 * i + 1];
      }
    }
    for (let c = 0; c < n; c++) {
      for (let i = 0; i < n; i++) {
        row[2 * i] = fwd[(i * n + c) * 2];
        row[2 * i + 1] = fwd[(i * n + c) * 2 + 1];
      }
      const r = dftForwardNaive(row);
      for (let i = 0; i < n; i++) {
        fwd[(i * n + c) * 2] = r[2 * i];
        fwd[(i * n + c) * 2 + 1] = r[2 * i + 1];
      }
    }
    expect(maxAbsDiff(x, ifft2D(fwd, n))).toBeLessThan(1e-9);
  });

  it("rejects non-power-of-two sizes", () => {
    expect(() => ifft1D(new Float64Array(12))).toThrow();
  });
});

describe("phillips", () => {
  it("is zero at k=0, wind-aligned, and positive", () => {
    expect(phillips(0, 0, 6, 1, 0, 1)).toBe(0);
    const aligned = phillips(1, 0, 6, 1, 0, 1);
    const across = phillips(0, 1, 6, 1, 0, 1);
    expect(aligned).toBeGreaterThan(0);
    expect(aligned).toBeGreaterThan(across);
  });

  it("rolls off outside the detail band", () => {
    const low = 0.39;
    const high = Math.PI;
    const long = phillips(0.1, 0, 3.7, 1, 0, 1, 0.001, low, high);
    const longUncut = phillips(0.1, 0, 3.7, 1, 0, 1);
    expect(long / longUncut).toBeLessThan(0.1);
    const short = phillips(8, 0, 3.7, 1, 0, 1, 0.001, low, high);
    const shortUncut = phillips(8, 0, 3.7, 1, 0, 1);
    expect(short / shortUncut).toBeLessThan(0.01);
    const mid = phillips(1, 0, 3.7, 1, 0, 1, 0.001, low, high);
    const midUncut = phillips(1, 0, 3.7, 1, 0, 1);
    expect(mid / midUncut).toBeGreaterThan(0.9);
  });
});

describe("mirrorIndex", () => {
  it("is an involution with 0 fixed", () => {
    expect(mirrorIndex(0, 256)).toBe(0);
    for (let i = 0; i < 256; i++) expect(mirrorIndex(mirrorIndex(i, 256), 256)).toBe(i);
  });
});

describe("buildH0Data", () => {
  it("is deterministic per seed", () => {
    expect(buildH0Data(DEFAULT_SPECTRUM, 1)).toEqual(buildH0Data(DEFAULT_SPECTRUM, 1));
    expect(buildH0Data(DEFAULT_SPECTRUM, 1)).not.toEqual(buildH0Data(DEFAULT_SPECTRUM, 2));
  });

  it("has zero mean (no DC offset)", () => {
    const h0 = buildH0Data(DEFAULT_SPECTRUM);
    let re = 0;
    let im = 0;
    for (let i = 0; i < h0.length; i += 4) {
      re += h0[i];
      im += h0[i + 1];
    }
    // Gaussian soup: mean near zero relative to spread.
    let spread = 0;
    for (let i = 0; i < h0.length; i += 4) spread += Math.abs(h0[i]);
    expect(Math.abs(re) / spread).toBeLessThan(0.05);
    expect(Math.abs(im) / spread).toBeLessThan(0.05);
  });
});

describe("detail amplitude", () => {
  it("stays in the detail band (CPU IFFT at t=0)", () => {
    const h0 = buildH0Data(DEFAULT_SPECTRUM);
    const dy = evolveSpectrum(h0, DEFAULT_SPECTRUM, 0, 1);
    const spatial = ifft2D(dy, DEFAULT_SPECTRUM.size);
    let max = 0;
    for (let i = 0; i < spatial.length; i += 2) max = Math.max(max, Math.abs(spatial[i]));
    expect(max).toBeGreaterThan(0.15);
    expect(max).toBeLessThan(0.5);
  });
});
