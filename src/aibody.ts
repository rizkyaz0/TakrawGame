import * as THREE from "three";
import { loader } from "./models";

// Badan karakter hasil model 3D AI (public/models/chars/*.glb). Modelnya satu patung utuh
// tanpa rangka, jadi di sini badannya dipotong secara "lunak": tiap titik diberi bobot ke
// sendi yang dipakai animator (badan, pinggul, lutut, kaki, bahu, siku). Wajah ikut menempel
// di tekstur, jadi pupil tidak mengikuti bola.

// Nomor tulang, dipakai juga oleh FoodCharacter.
export const BONE = {
  spine: 0,
  legL: 1,
  kneeL: 2,
  footL: 3,
  legR: 4,
  kneeR: 5,
  footR: 6,
  armL: 7,
  elbowL: 8,
  armR: 9,
  elbowR: 10,
} as const;
const BONES = 11;

export interface AiBody {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  joints: {
    hipY: number; // tinggi pinggul dari dasar badan
    hipZ: number; // jarak kaki dari tengah
    kneeDy: number; // lutut di bawah pinggul
    footDy: number; // pergelangan di bawah lutut
    shoulderY: number; // dari titik putar badan (spine)
    shoulderZ: number;
    elbowDy: number; // siku di bawah bahu
    elbowDz: number;
  };
}

const SLUGS: Record<number, string> = { 0: "bang-sosis" };

// Skala model ke satuan game, dan titik-titik sendi pada model (satuan model, tinggi 1,08).
const K = 1.6;
const GROUND = -0.085; // dasar sepatu, sama dengan sepatu buatan kode
const Z0 = 0.01; // tengah badan pada sumbu depan-belakang
const STUB_LO = 0.12; // pergelangan: dari sini ke atas betis dipanjangkan
const STUB_HI = 0.21;
const STUB_ADD = 0.1;
const HIP_Y = 0.31; // setelah betis dipanjangkan
const KNEE_Y = 0.215;
const ANKLE_Y = 0.12;
const SHOULDER = { x: 0.15, y: 0.72 };
const HAND = { x: 0.4, y: 0.34 };
const SPINE_PIVOT = 0.42; // sama dengan HIP_Y di foodchar.ts

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Kaki asli model cuma tonjolan pendek di atas sepatu: panjangkan supaya bisa menekuk.
function remapY(y: number): number {
  if (y <= STUB_LO) return y;
  if (y >= STUB_HI) return y + STUB_ADD;
  return STUB_LO + (y - STUB_LO) * (1 + STUB_ADD / (STUB_HI - STUB_LO));
}

function build(scene: THREE.Object3D): AiBody | null {
  let mesh: THREE.Mesh | null = null;
  scene.traverse((o) => {
    if (!mesh && o instanceof THREE.Mesh) mesh = o;
  });
  const src = mesh as THREE.Mesh | null;
  if (!src) return null;
  scene.updateMatrixWorld(true);
  const pos = src.geometry.attributes.position;
  const nor = src.geometry.attributes.normal;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const idx = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  const nm = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const w = new Float32Array(BONES);
  const dx = HAND.x - SHOULDER.x;
  const dy = HAND.y - SHOULDER.y;
  const len2 = dx * dx + dy * dy;

  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(src.matrixWorld);
    nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const x = v.x;
    const ax = Math.abs(x);
    const z = v.z - Z0;
    const y = remapY(v.y);
    const left = x > 0; // sisi kiri game ada di z negatif = x model positif

    // Tangan: jarak ke garis bahu-ujung tangan.
    const t = Math.min(1, Math.max(0, ((ax - SHOULDER.x) * dx + (y - SHOULDER.y) * dy) / len2));
    const dist = Math.hypot(ax - (SHOULDER.x + dx * t), y - (SHOULDER.y + dy * t), z * 0.5);
    const mArm = (1 - ss(0.08, 0.12, dist)) * ss(0.12, 0.16, ax) * (y < 0.9 ? 1 : 0);
    // Kaki: bagian bawah, dekat sumbu, dan bukan tangan.
    const mLeg = (1 - ss(0.3, 0.4, y)) * (1 - ss(0.17, 0.21, ax)) * (1 - mArm);

    w.fill(0);
    const armTorso = 1 - ss(0, 0.2, t);
    const el = ss(0.38, 0.62, t);
    const armShare = mArm * (1 - armTorso);
    w[left ? BONE.armL : BONE.armR] = armShare * (1 - el);
    w[left ? BONE.elbowL : BONE.elbowR] = armShare * el;
    const sideL = ss(-0.03, 0.03, x);
    const foot = 1 - ss(ANKLE_Y, ANKLE_Y + 0.04, y);
    const hip = ss(KNEE_Y - 0.045, KNEE_Y + 0.045, y);
    const kneeW = (1 - foot) * (1 - hip);
    w[BONE.footL] += mLeg * sideL * foot;
    w[BONE.kneeL] += mLeg * sideL * kneeW;
    w[BONE.legL] += mLeg * sideL * (1 - foot) * hip;
    w[BONE.footR] += mLeg * (1 - sideL) * foot;
    w[BONE.kneeR] += mLeg * (1 - sideL) * kneeW;
    w[BONE.legR] += mLeg * (1 - sideL) * (1 - foot) * hip;
    let used = 0;
    for (let b = 1; b < BONES; b++) used += w[b];
    w[BONE.spine] = Math.max(0, 1 - used);

    // Empat bobot terbesar.
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      let best = 0;
      for (let b = 1; b < BONES; b++) if (w[b] > w[best]) best = b;
      idx[i * 4 + k] = best;
      wt[i * 4 + k] = w[best];
      sum += w[best];
      w[best] = -1;
    }
    for (let k = 0; k < 4; k++) wt[i * 4 + k] /= sum || 1;

    // Model menghadap +z; game menghadap +x.
    P[i * 3] = z * K;
    P[i * 3 + 1] = y * K + GROUND;
    P[i * 3 + 2] = -x * K;
    N[i * 3] = nv.z;
    N[i * 3 + 1] = nv.y;
    N[i * 3 + 2] = -nv.x;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", src.geometry.attributes.uv);
  g.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(wt, 4));
  g.setIndex(src.geometry.index);
  g.computeBoundingSphere();

  const hipY = HIP_Y * K + GROUND;
  const shY = SHOULDER.y * K + GROUND;
  const elMidX = (SHOULDER.x + HAND.x) / 2;
  const elMidY = (SHOULDER.y + HAND.y) / 2;
  const mat = Array.isArray(src.material) ? src.material[0] : src.material;
  return {
    geometry: g,
    map: (mat as THREE.MeshStandardMaterial).map ?? null,
    joints: {
      hipY,
      hipZ: 0.065 * K,
      kneeDy: (HIP_Y - KNEE_Y) * K,
      footDy: (KNEE_Y - ANKLE_Y) * K,
      shoulderY: shY - SPINE_PIVOT,
      shoulderZ: SHOULDER.x * K,
      elbowDy: (elMidY - SHOULDER.y) * K,
      elbowDz: (elMidX - SHOULDER.x) * K,
    },
  };
}

const ready = new Map<number, AiBody>();
const pending = new Map<number, Promise<AiBody | null>>();

export function aiBodyIfReady(charId: number): AiBody | undefined {
  return ready.get(charId);
}

// Memuat dan mengolah badan sekali; null kalau karakter ini tidak punya model AI atau gagal dimuat.
export function loadAiBody(charId: number): Promise<AiBody | null> {
  const slug = SLUGS[charId];
  if (!slug) return Promise.resolve(null);
  let p = pending.get(charId);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/chars/${slug}.glb`)
      .then((gltf) => {
        const body = build(gltf.scene);
        if (body) ready.set(charId, body);
        return body;
      })
      .catch(() => null);
    pending.set(charId, p);
  }
  return p;
}
