/**
 * CPU FFT reference (Float64). A 2D bit-reversal pass followed by
 * decimation-in-time stages; the GPU port mirrors this file loop-for-loop,
 * and the test proves it against naive DFT — which is what makes the blind
 * GLSL port trustworthy.
 */

export function dftForwardNaive(src: Float64Array): Float64Array {
  const n = src.length / 2;
  const out = new Float64Array(src.length);
  for (let k = 0; k < n; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < n; j++) {
      const ang = (-2 * Math.PI * k * j) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      re += src[2 * j] * c - src[2 * j + 1] * s;
      im += src[2 * j] * s + src[2 * j + 1] * c;
    }
    out[2 * k] = re;
    out[2 * k + 1] = im;
  }
  return out;
}

export function bitReverse(i: number, bits: number): number {
  let r = 0;
  for (let b = 0; b < bits; b++) r = r * 2 + ((i >> b) & 1);
  return r;
}

/** DIT inverse stage pass over bit-reversed input. Unnormalized. */
export function ditInverse(bitReversed: Float64Array): Float64Array {
  const n = bitReversed.length / 2;
  const stages = Math.log2(n);
  if (!Number.isInteger(stages)) throw new Error("size must be a power of two");
  let input = Float64Array.from(bitReversed);
  let output = new Float64Array(bitReversed.length);
  for (let s = 1; s <= stages; s++) {
    const block = 2 ** s;
    const half = block / 2;
    for (let base = 0; base < n; base += block) {
      for (let j = 0; j < half; j++) {
        const ang = (2 * Math.PI * j) / block;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const ar = input[2 * (base + j)];
        const ai = input[2 * (base + j) + 1];
        const br = input[2 * (base + j + half)];
        const bi = input[2 * (base + j + half) + 1];
        const wbr = wr * br - wi * bi;
        const wbi = wr * bi + wi * br;
        output[2 * (base + j)] = ar + wbr;
        output[2 * (base + j) + 1] = ai + wbi;
        output[2 * (base + j + half)] = ar - wbr;
        output[2 * (base + j + half) + 1] = ai - wbi;
      }
    }
    const tmp = input;
    input = output;
    output = tmp;
  }
  return input;
}

/** Full 1D inverse FFT: bit-reverse, DIT stages, 1/N scale. */
export function ifft1D(src: Float64Array): Float64Array {
  const n = src.length / 2;
  const bits = Math.log2(n);
  const shuffled = new Float64Array(src.length);
  for (let i = 0; i < n; i++) {
    const r = bitReverse(i, bits);
    shuffled[2 * i] = src[2 * r];
    shuffled[2 * i + 1] = src[2 * r + 1];
  }
  const out = ditInverse(shuffled);
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** 2D inverse FFT (bit-reverse both axes once, DIT rows, DIT cols). */
export function ifft2D(src: Float64Array, size: number): Float64Array {
  const bits = Math.log2(size);
  if (!Number.isInteger(bits)) throw new Error("size must be a power of two");
  const shuffled = new Float64Array(src.length);
  for (let m = 0; m < size; m++) {
    for (let n = 0; n < size; n++) {
      const rn = bitReverse(n, bits);
      const rm = bitReverse(m, bits);
      shuffled[(m * size + n) * 2] = src[(rm * size + rn) * 2];
      shuffled[(m * size + n) * 2 + 1] = src[(rm * size + rn) * 2 + 1];
    }
  }
  const line = new Float64Array(size * 2);
  const tmp = new Float64Array(src.length);
  for (let m = 0; m < size; m++) {
    for (let n = 0; n < size; n++) {
      line[2 * n] = shuffled[(m * size + n) * 2];
      line[2 * n + 1] = shuffled[(m * size + n) * 2 + 1];
    }
    const out = ditInverse(line);
    for (let n = 0; n < size; n++) {
      tmp[(m * size + n) * 2] = out[2 * n];
      tmp[(m * size + n) * 2 + 1] = out[2 * n + 1];
    }
  }
  const out = new Float64Array(src.length);
  const norm = 1 / (size * size);
  for (let n = 0; n < size; n++) {
    for (let m = 0; m < size; m++) {
      line[2 * m] = tmp[(m * size + n) * 2];
      line[2 * m + 1] = tmp[(m * size + n) * 2 + 1];
    }
    const colOut = ditInverse(line);
    for (let m = 0; m < size; m++) {
      out[(m * size + n) * 2] = colOut[2 * m] * norm;
      out[(m * size + n) * 2 + 1] = colOut[2 * m + 1] * norm;
    }
  }
  return out;
}
