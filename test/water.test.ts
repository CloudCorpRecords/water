import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { beerLambert, schlick } from "../src/optics";
import { applyObliqueClipping, mirrorFrame } from "../src/reflection";
import { ISLAND_X, ISLAND_Z, seabedHeight } from "../src/seabed";

describe("mirrorFrame", () => {
  it("reflects across y=0", () => {
    const m = mirrorFrame(
      new THREE.Vector3(0, 10, 5),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0)
    );
    expect(m.position.toArray()).toEqual([0, -10, 5]);
    expect(m.target.toArray()).toEqual([0, 0, 0]);
    expect(m.up.toArray()).toEqual([0, -1, 0]);
  });

  it("is an involution", () => {
    const eye = new THREE.Vector3(28, 16, 28);
    const target = new THREE.Vector3(0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const once = mirrorFrame(eye, target, up);
    const twice = mirrorFrame(once.position, once.target, once.up);
    expect(twice.position.toArray()).toEqual(eye.toArray());
    expect(twice.target.toArray()).toEqual(target.toArray());
    expect(twice.up.toArray()).toEqual(up.toArray());
  });
});

describe("applyObliqueClipping", () => {
  it("rewrites the projection deterministically", () => {
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
    cam.updateProjectionMatrix();
    const a = cam.projectionMatrix.clone();
    const b = cam.projectionMatrix.clone();
    applyObliqueClipping(a, new THREE.Vector4(0, 1, 0, 2), 0.003);
    applyObliqueClipping(b, new THREE.Vector4(0, 1, 0, 2), 0.003);
    expect(a.elements).toEqual(b.elements);
    expect(a.elements).not.toEqual(cam.projectionMatrix.elements);
  });
});

describe("seabedHeight", () => {
  it("breaches at the island and stays deep at the origin", () => {
    const peak = seabedHeight(ISLAND_X, ISLAND_Z);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(4);
    expect(seabedHeight(0, 0)).toBeLessThan(-6);
  });

  it("is deterministic", () => {
    expect(seabedHeight(12.5, -7.25)).toBe(seabedHeight(12.5, -7.25));
  });
});

describe("schlick", () => {
  it("spans F0 to 1", () => {
    expect(schlick(1)).toBeCloseTo(0.02, 9);
    expect(schlick(0)).toBeCloseTo(1, 9);
    expect(schlick(0.5)).toBeGreaterThan(schlick(0.9));
  });
});

describe("beerLambert", () => {
  it("is clear at zero thickness and absorbs red fastest", () => {
    expect(beerLambert(0, [0.32, 0.14, 0.1])).toEqual([1, 1, 1]);
    const [r, g, b] = beerLambert(8, [0.32, 0.14, 0.1]);
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
    expect(r).toBeLessThan(0.15);
  });
});
