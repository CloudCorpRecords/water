import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFloaterState, updateFloater } from "../src/buoyancy";

const DT = 1 / 60;

describe("buoyancy", () => {
  it("pushes a sunken body up and a high body down", () => {
    const low = new THREE.Object3D();
    low.position.set(0, -2, 0);
    const lowState = createFloaterState();
    updateFloater(low, lowState, DT, 0, { waves: [] });
    expect(lowState.velocity.y).toBeGreaterThan(0);

    const high = new THREE.Object3D();
    high.position.set(0, 2, 0);
    const highState = createFloaterState();
    updateFloater(high, highState, DT, 0, { waves: [] });
    expect(highState.velocity.y).toBeLessThan(0);
  });

  it("settles at the surface on still water", () => {
    const obj = new THREE.Object3D();
    obj.position.set(0, -3, 0);
    const st = createFloaterState();
    for (let i = 0; i < 1200; i++) updateFloater(obj, st, DT, 0, { waves: [] });
    expect(obj.position.y).toBeCloseTo(0, 1);
    expect(Math.abs(st.velocity.y)).toBeLessThan(0.1);
  });

  it("respects draft offset", () => {
    const obj = new THREE.Object3D();
    obj.position.set(0, -3, 0);
    const st = createFloaterState();
    for (let i = 0; i < 1200; i++) updateFloater(obj, st, DT, 0, { waves: [], draft: -0.5 });
    expect(obj.position.y).toBeCloseTo(-0.5, 1);
  });

  it("uprights a tilted body on flat water", () => {
    const obj = new THREE.Object3D();
    obj.rotation.z = 0.5;
    const st = createFloaterState();
    for (let i = 0; i < 600; i++) updateFloater(obj, st, DT, 0, { waves: [] });
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
    expect(up.y).toBeCloseTo(1, 2);
  });

  it("tracks a moving wave without exploding", () => {
    const obj = new THREE.Object3D();
    obj.position.set(5, 0, -3);
    const st = createFloaterState();
    for (let i = 0; i < 1200; i++) updateFloater(obj, st, DT, i * DT);
    expect(Number.isFinite(obj.position.y)).toBe(true);
    expect(Math.abs(obj.position.y)).toBeLessThan(3);
  });
});
