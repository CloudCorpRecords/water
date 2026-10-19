/**
 * Shared wave model: the single source of truth for water height.
 *
 * The GPU vertex shader is generated from these same constants, and the CPU
 * buoyancy sampler evaluates the identical vertical sum, so rendered waves
 * and floating bodies always agree. The GPU additionally applies horizontal
 * Gerstner chop (steepness) which the CPU sampler ignores — a deliberate,
 * centimeter-scale approximation documented here, not drift.
 *
 * Temporal frequencies follow deep-water dispersion: omega = sqrt(g * k).
 */

export interface Wave {
  /** Normalized travel direction in world XZ. */
  dirX: number;
  dirZ: number;
  /** Vertical amplitude in meters. */
  amplitude: number;
  /** Wavelength in meters. */
  wavelength: number;
  /** Temporal frequency in rad/s (omega). */
  omega: number;
  /** Horizontal chop factor (GPU only). */
  steepness: number;
}

interface RawWave {
  dirX: number;
  dirZ: number;
  amplitude: number;
  wavelength: number;
  steepness: number;
}

const GRAVITY = 9.81;

const RAW_WAVES: RawWave[] = [
  { dirX: 1.0, dirZ: 0.3, amplitude: 0.55, wavelength: 28.0, steepness: 0.5 },
  { dirX: 0.7, dirZ: -0.7, amplitude: 0.28, wavelength: 13.0, steepness: 0.5 },
  { dirX: -0.4, dirZ: 0.9, amplitude: 0.14, wavelength: 6.5, steepness: 0.4 },
  { dirX: 0.9, dirZ: 0.5, amplitude: 0.07, wavelength: 3.4, steepness: 0.3 }
];

function dispersionOmega(wavelength: number): number {
  return Math.sqrt(GRAVITY * ((2 * Math.PI) / wavelength));
}

export const WAVES: Wave[] = RAW_WAVES.map((w) => {
  const len = Math.hypot(w.dirX, w.dirZ);
  return {
    dirX: w.dirX / len,
    dirZ: w.dirZ / len,
    amplitude: w.amplitude,
    wavelength: w.wavelength,
    omega: dispersionOmega(w.wavelength),
    steepness: w.steepness
  };
});

/** Sum of amplitudes: hard bound on |height|. */
export const TOTAL_AMPLITUDE: number = WAVES.reduce((s, w) => s + w.amplitude, 0);

export function waveNumber(w: Wave): number {
  return (2 * Math.PI) / w.wavelength;
}

/** Water surface height at world (x, z) and time t (seconds). */
export function waveHeight(x: number, z: number, t: number, waves: Wave[] = WAVES): number {
  let h = 0;
  for (const w of waves) {
    const k = waveNumber(w);
    h += w.amplitude * Math.sin(k * (w.dirX * x + w.dirZ * z) - w.omega * t);
  }
  return h;
}

export type Vec3 = [number, number, number];

/** Surface normal via central differences. Always unit length, +Y on flat water. */
export function waveNormal(
  x: number,
  z: number,
  t: number,
  waves: Wave[] = WAVES,
  eps = 0.35
): Vec3 {
  const dx = (waveHeight(x + eps, z, t, waves) - waveHeight(x - eps, z, t, waves)) / (2 * eps);
  const dz = (waveHeight(x, z + eps, t, waves) - waveHeight(x, z - eps, t, waves)) / (2 * eps);
  const inv = 1 / Math.hypot(dx, 1, dz);
  return [-dx * inv + 0, inv, -dz * inv + 0];
}
