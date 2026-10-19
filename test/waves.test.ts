import { describe, expect, it } from "vitest";
import { TOTAL_AMPLITUDE, WAVES, waveHeight, waveNormal, waveNumber, type Wave } from "../src/waves";
import { getVertexShader } from "../src/waterMaterial";

const SINGLE: Wave[] = [{ dirX: 1, dirZ: 0, amplitude: 2, wavelength: 2 * Math.PI, omega: 1, steepness: 0 }];

describe("waveHeight", () => {
  it("is deterministic", () => {
    expect(waveHeight(3.1, -2.7, 12.5)).toBe(waveHeight(3.1, -2.7, 12.5));
  });

  it("stays within the amplitude bound", () => {
    for (let x = -30; x <= 30; x += 3.7) {
      for (let z = -30; z <= 30; z += 4.1) {
        expect(Math.abs(waveHeight(x, z, 7.3))).toBeLessThanOrEqual(TOTAL_AMPLITUDE + 1e-9);
      }
    }
  });

  it("peaks a single wave at phase pi/2", () => {
    // k = 1, omega = 1: f = x - t; max at x = pi/2, t = 0.
    expect(waveHeight(Math.PI / 2, 0, 0, SINGLE)).toBeCloseTo(2, 9);
    expect(waveHeight(-Math.PI / 2, 5, 0, SINGLE)).toBeCloseTo(-2, 9);
  });

  it("is flat with no waves", () => {
    expect(waveHeight(10, -4, 99, [])).toBe(0);
  });

  it("uses deep-water dispersion", () => {
    for (const w of WAVES) {
      expect(w.omega).toBeCloseTo(Math.sqrt(9.81 * waveNumber(w)), 9);
    }
  });
});

describe("waveNormal", () => {
  it("is unit length and points up", () => {
    for (let x = -20; x <= 20; x += 5.3) {
      const n = waveNormal(x, -x / 2, 3.1);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
      expect(n[1]).toBeGreaterThan(0);
    }
  });

  it("is straight up on flat water", () => {
    expect(waveNormal(4, 9, 2, [])).toEqual([0, 1, 0]);
  });

  it("is straight up at a wave crest", () => {
    const n = waveNormal(Math.PI / 2, 0, 0, SINGLE);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(1, 6);
  });
});

describe("CPU/GPU agreement", () => {
  it("bakes every shared wave constant into the vertex shader", () => {
    const glsl = getVertexShader();
    for (const w of WAVES) {
      expect(glsl).toContain(w.amplitude.toFixed(6));
      expect(glsl).toContain(waveNumber(w).toFixed(6));
      expect(glsl).toContain(w.omega.toFixed(6));
    }
    expect(glsl).toContain(TOTAL_AMPLITUDE.toFixed(6));
  });
});
