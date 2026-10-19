import * as THREE from "three";
import { WAVES, waveHeight, waveNormal, type Wave } from "./waves";

export interface BuoyancyOptions {
  /** Spring stiffness toward the surface (1/s^2). */
  buoyancy?: number;
  /** Vertical velocity damping (1/s). */
  damping?: number;
  /** How fast the body tilts to match the wave normal (1/s). */
  tiltFollow?: number;
  /** Downhill slope drift strength. */
  drift?: number;
  /** Rest offset from the surface; negative floats lower. */
  draft?: number;
  /** Wave set override (defaults to the shared model). */
  waves?: Wave[];
}

export interface FloaterState {
  velocity: THREE.Vector3;
}

export function createFloaterState(): FloaterState {
  return { velocity: new THREE.Vector3() };
}

const UP = new THREE.Vector3(0, 1, 0);
const scratchNormal = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();

/**
 * Single-point buoyancy: vertical spring-damper against the sampled wave
 * height, slope drift with water drag, and slerp of the up axis toward the
 * wave normal. Semi-implicit Euler; stable for dt <= 1/30 at defaults.
 */
export function updateFloater(
  obj: THREE.Object3D,
  st: FloaterState,
  dt: number,
  t: number,
  opts: BuoyancyOptions = {}
): void {
  const {
    buoyancy = 6,
    damping = 1.6,
    tiltFollow = 2.2,
    drift = 0.35,
    draft = 0,
    waves = WAVES
  } = opts;
  const p = obj.position;
  const h = waveHeight(p.x, p.z, t, waves);
  const n = waveNormal(p.x, p.z, t, waves);

  const submersion = h + draft - p.y;
  st.velocity.y += (buoyancy * submersion - damping * st.velocity.y) * dt;

  const drag = 1 - Math.min(0.9, (submersion > -0.5 ? 1.2 : 0.05) * dt);
  st.velocity.x = st.velocity.x * drag + -n[0] * drift * dt;
  st.velocity.z = st.velocity.z * drag + -n[2] * drift * dt;

  p.x += st.velocity.x * dt;
  p.y += st.velocity.y * dt;
  p.z += st.velocity.z * dt;

  scratchNormal.set(n[0], n[1], n[2]);
  scratchQuat.setFromUnitVectors(UP, scratchNormal);
  obj.quaternion.slerp(scratchQuat, Math.min(1, tiltFollow * dt));
}
