import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FoodCharacter } from "./foodchar";
import { toon } from "./style";

// Penonton berbentuk jajanan: badan tiap jajanan dari FoodCharacter (tanpa tangan dan kaki), wajah
// sederhana, semuanya digabung jadi SATU geometri berwarna per jenis. Satu penonton = satu mesh
// (ditambah garis tepinya), jadi jumlah panggilan gambar tetap kecil.

const cache = new Map<number, THREE.BufferGeometry>();
export const CROWD_HEIGHT = 0.95;

let sharedMat: THREE.MeshToonMaterial | null = null;
export function crowdMaterial(): THREE.MeshToonMaterial {
  if (!sharedMat) sharedMat = toon(0xffffff, { vertexColors: true });
  return sharedMat;
}

function part(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, out: THREE.BufferGeometry[]): void {
  let g = geo.clone();
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute("uv");
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.push(g);
}

export function crowdGeometry(kind: number): THREE.BufferGeometry {
  const hit = cache.get(kind);
  if (hit) return hit;
  const ch = new FoodCharacter(kind, true);
  ch.root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  ch.root.traverse((o) => {
    if (o.name === "outline" || !(o instanceof THREE.Mesh)) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshToonMaterial;
    const color = mat.color ?? new THREE.Color(0xffffff);
    if (o instanceof THREE.InstancedMesh) {
      const im = new THREE.Matrix4();
      const m = new THREE.Matrix4();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        part(o.geometry, m.multiplyMatrices(o.matrixWorld, im), color, parts);
      }
    } else {
      part(o.geometry, o.matrixWorld, color, parts);
    }
  });

  // Wajah di permukaan depan badan (menghadap +x di FoodCharacter, jadi diputar nanti).
  const s = ch.spec;
  const fs = s.faceSize * 1.1;
  const white = new THREE.Color(0xffffff);
  const ink = new THREE.Color(0x17131c);
  const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color) => {
    const m = new THREE.Matrix4().multiplyMatrices(ch.spine.matrixWorld, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
    part(geo, m, c, parts);
  };
  const ball = new THREE.SphereGeometry(1, 8, 6);
  for (const z of [-0.14 * fs, 0.14 * fs]) {
    place(ball, s.faceX, s.faceY, z, 0.04 * fs, 0.15 * fs, 0.11 * fs, white);
    place(ball, s.faceX + 0.03 * fs, s.faceY, z, 0.02 * fs, 0.075 * fs, 0.065 * fs, ink);
  }
  place(ball, s.faceX + 0.01 * fs, s.faceY - 0.16 * fs, 0, 0.02 * fs, 0.04 * fs, 0.09 * fs, ink);
  ball.dispose();

  let merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  ch.dispose();
  if (!merged) merged = new THREE.BoxGeometry(0.5, 0.8, 0.5);
  // Menghadap +z (ke arah penonton melihat lapangan), alas di y=0, tinggi seragam.
  merged.rotateY(-Math.PI / 2);
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  merged.translate(0, -box.min.y, 0);
  const scale = CROWD_HEIGHT / Math.max(0.2, box.max.y - box.min.y);
  merged.scale(scale, scale, scale);
  merged.computeBoundingSphere();
  cache.set(kind, merged);
  return merged;
}
