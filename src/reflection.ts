import * as THREE from "three";

export interface MirrorFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}

/** Mirror a camera frame across the y = waterLevel plane. Pure math. */
export function mirrorFrame(
  eye: THREE.Vector3,
  target: THREE.Vector3,
  up: THREE.Vector3,
  waterLevel = 0
): MirrorFrame {
  const mirrorPoint = (p: THREE.Vector3): THREE.Vector3 =>
    new THREE.Vector3(p.x, 2 * waterLevel - p.y, p.z);
  const mirrorDir = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x, -v.y, v.z);
  return { position: mirrorPoint(eye), target: mirrorPoint(target), up: mirrorDir(up) };
}

/**
 * Oblique near-plane clipping tweak (three.js Reflector formulation):
 * folds the water clip plane into the projection matrix so geometry below
 * the surface never leaks into the reflection.
 */
export function applyObliqueClipping(
  projection: THREE.Matrix4,
  clipPlane: THREE.Vector4,
  clipBias: number
): void {
  const e = projection.elements;
  const q = new THREE.Vector4(
    (Math.sign(clipPlane.x) + e[8]) / e[0],
    (Math.sign(clipPlane.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14]
  );
  clipPlane.multiplyScalar(2 / clipPlane.dot(q));
  e[2] = clipPlane.x;
  e[6] = clipPlane.y;
  e[10] = clipPlane.z + 1 - clipBias;
  e[14] = clipPlane.w;
}

/** Planar reflection across the mean water level (y = 0). */
export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  /** Bias * mirrorProj * mirrorView; water mesh is at origin (identity). */
  readonly textureMatrix = new THREE.Matrix4();
  private mirrorCamera = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    hide: THREE.Object3D[]
  ): void {
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= 0) return;
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    const frame = mirrorFrame(eye, eye.clone().add(dir), up);

    const mirror = this.mirrorCamera;
    mirror.position.copy(frame.position);
    mirror.up.copy(frame.up);
    mirror.lookAt(frame.target);
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.updateProjectionMatrix();
    mirror.updateMatrixWorld();

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(mirror.projectionMatrix);
    this.textureMatrix.multiply(mirror.matrixWorldInverse);

    const clip = new THREE.Vector4(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    this.plane.applyMatrix4(mirror.matrixWorldInverse);
    clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    this.plane.set(new THREE.Vector3(0, 1, 0), 0);
    applyObliqueClipping(mirror.projectionMatrix, clip, 0.003);

    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(prevTarget);
    for (const o of hide) o.visible = true;
  }
}
