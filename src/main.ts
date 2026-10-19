import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OceanFFT } from "./ocean";
import { PlanarReflection } from "./reflection";
import { buildSeabed } from "./seabed";
import { buildSky } from "./sky";
import { buildWaterMaterial } from "./waterMaterial";
import { createFloaterState, updateFloater, type FloaterState } from "./buoyancy";

const SUN_DIR = new THREE.Vector3(-0.4, 0.8, -0.35).normalize();

function makeScene(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc8e8);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(28, 16, 28);
  return { renderer, scene, camera };
}

function makeWater(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geometry = new THREE.PlaneGeometry(240, 240, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const material = buildWaterMaterial(SUN_DIR);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

interface Floater {
  group: THREE.Group;
  state: FloaterState;
  draft: number;
  blobRadius: number;
}

function makeFloater(mesh: THREE.Mesh, x: number, z: number, draft: number, blobRadius: number): Floater {
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(x, 0, z);
  return { group, state: createFloaterState(), draft, blobRadius };
}

function matte(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.0 });
}

function main(): void {
  const { renderer, scene, camera } = makeScene();

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x1b3a55, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const { mesh: water, material } = makeWater();
  scene.add(water);
  scene.add(buildSky(SUN_DIR));
  scene.add(buildSeabed(220)); // tucks under the 240 m water plane

  const ocean = new OceanFFT(renderer);
  material.uniforms.uDisp.value = ocean.texture;
  material.uniforms.uTileLen.value = ocean.tileLength;
  material.uniforms.uDetail.value = Number.parseFloat(
    new URLSearchParams(window.location.search).get("detail") ?? "1"
  );
  ocean.update(0);

  // Half-res scene passes. Fixed at startup size (UVs stay correct on resize).
  const rtW = Math.floor(window.innerWidth / 2);
  const rtH = Math.floor(window.innerHeight / 2);
  const reflection = new PlanarReflection(rtW, rtH);
  const refrTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
    type: THREE.HalfFloatType,
    depthBuffer: true
  });
  refrTarget.depthTexture = new THREE.DepthTexture(rtW, rtH);
  material.uniforms.uReflection.value = reflection.texture;
  material.uniforms.uReflMatrix.value = reflection.textureMatrix;
  material.uniforms.uRefraction.value = refrTarget.texture;
  material.uniforms.uDepthMap.value = refrTarget.depthTexture;
  const sceneMatrix = new THREE.Matrix4();
  material.uniforms.uSceneMatrix.value = sceneMatrix;
  material.uniforms.uDebug.value = Number.parseFloat(
    new URLSearchParams(window.location.search).get("debug") ?? "0"
  );

  const plank = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 3, 6, 12), matte(0xa07d55));
  plank.rotation.z = Math.PI / 2;
  const floaters: Floater[] = [
    makeFloater(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), matte(0x8d7354)), -7, -4, -0.3, 1.7),
    makeFloater(new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), matte(0x5f7d6b)), 6, 4, -0.2, 1.1),
    makeFloater(new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 18), matte(0xc23b2e)), 9, -7, -0.2, 1.3),
    makeFloater(plank, -9, 6, -0.1, 2.0)
  ];
  for (const f of floaters) scene.add(f.group);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = 1.45;
  controls.minDistance = 6;
  controls.maxDistance = 160;
  controls.enableDamping = true;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let simTime = 0;

  const floaterGroups = floaters.map((f) => f.group);
  const blobs = material.uniforms.uBlobs.value as THREE.Vector4[];

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!reduceMotion) simTime += dt;
    material.uniforms.uTime.value = simTime;
    if (!reduceMotion) ocean.update(simTime);
    for (const f of floaters) updateFloater(f.group, f.state, dt, simTime, { draft: f.draft });
    controls.update();
    camera.updateMatrixWorld();
    sceneMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    reflection.render(renderer, scene, camera, [water]);

    water.visible = false;
    for (const g of floaterGroups) g.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(refrTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    water.visible = true;
    for (const g of floaterGroups) g.visible = true;

    for (let i = 0; i < blobs.length; i++) {
      const f = floaters[i];
      blobs[i].set(f.group.position.x, f.group.position.z, f.blobRadius, 0.8);
    }
    renderer.render(scene, camera);
  });
}

main();
