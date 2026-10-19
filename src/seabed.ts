import * as THREE from "three";

export const ISLAND_X = -32;
export const ISLAND_Z = -28;

/** Static seabed height: dunes plus one breaching island. Deterministic. */
export function seabedHeight(x: number, z: number): number {
  const dunes =
    1.6 * Math.sin(x * 0.05 + 1.7) * Math.sin(z * 0.043 + 0.6) +
    0.7 * Math.sin(x * 0.13 + 0.4) * Math.sin(z * 0.11 + 2.0);
  const dx = x - ISLAND_X;
  const dz = z - ISLAND_Z;
  const island = 12 * Math.exp(-(dx * dx + dz * dz) / (2 * 22 * 22));
  return -10 + dunes + island;
}

function sandShade(h: number): number {
  if (h > 0.6) return 1.0;
  if (h > -0.8) return 0.6;
  return Math.max(0.32, 0.85 + h * 0.05);
}

/** Seabed mesh with baked dune displacement + sand vertex colors. */
export function buildSeabed(size = 600, segments = 128): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = seabedHeight(x, z);
    pos.setY(i, h);
    const grain = 0.94 + 0.06 * Math.sin(x * 12.9898 + z * 78.233);
    const shade = sandShade(h) * grain;
    colors[i * 3] = 0.76 * shade;
    colors[i * 3 + 1] = 0.7 * shade;
    colors[i * 3 + 2] = 0.55 * shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
