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

// Tiap model punya ukuran sendiri. Semua titik di bawah dalam satuan model ASLI (tinggi ±1,1),
// kecuali dikatakan lain. Sendi-sendi lain (lutut, pergelangan) sama untuk semua.
interface Rig {
  slug: string;
  z0: number; // tengah badan pada sumbu depan-belakang
  stubHi: number; // tinggi tempat badan mulai (ujung atas tonjolan kaki asli)
  shoulder: { x: number; y: number };
  hand: { x: number; y: number };
  armX: [number, number]; // titik di dalam badan (|x| kecil) tidak ikut lengan
  hipY?: number; // tinggi pinggul setelah betis dipanjangkan (bawaan HIP_Y)
  legFade: [number, number]; // pengaruh kaki memudar di rentang ini, diukur dari pinggul
}

const RIGS: Record<number, Rig> = {
  7: { slug: "om-sate", z0: 0, stubHi: 0.23, shoulder: { x: 0.17, y: 0.58 }, hand: { x: 0.33, y: 0.3 }, armX: [0.14, 0.18], legFade: [-0.03, 0.04] },
  8: { slug: "mbok-klepon", z0: -0.03, stubHi: 0.17, hipY: 0.25, shoulder: { x: 0.25, y: 0.58 }, hand: { x: 0.53, y: 0.33 }, armX: [0.22, 0.27], legFade: [-0.06, 0] },
  9: { slug: "cak-kerupuk", z0: 0.015, stubHi: 0.19, hipY: 0.27, shoulder: { x: 0.38, y: 0.5 }, hand: { x: 0.57, y: 0.26 }, armX: [0.34, 0.4], legFade: [-0.03, 0.03] },
  10: { slug: "pakde-tempe", z0: -0.01, stubHi: 0.19, hipY: 0.26, shoulder: { x: 0.27, y: 0.58 }, hand: { x: 0.55, y: 0.26 }, armX: [0.24, 0.29], legFade: [-0.06, 0] },
  11: { slug: "neng-cendol", z0: 0, stubHi: 0.15, hipY: 0.21, shoulder: { x: 0.22, y: 0.52 }, hand: { x: 0.46, y: 0.27 }, armX: [0.19, 0.24], legFade: [-0.06, 0] },
  1: { slug: "mbak-lontong", z0: -0.01, stubHi: 0.19, hipY: 0.29, shoulder: { x: 0.19, y: 0.6 }, hand: { x: 0.42, y: 0.28 }, armX: [0.15, 0.19], legFade: [-0.06, 0] },
  2: { slug: "pak-bakso", z0: 0, stubHi: 0.26, shoulder: { x: 0.3, y: 0.62 }, hand: { x: 0.49, y: 0.22 }, armX: [0.27, 0.33], legFade: [-0.01, 0.05] },
  3: { slug: "mas-tahu", z0: -0.03, stubHi: 0.19, hipY: 0.26, shoulder: { x: 0.3, y: 0.57 }, hand: { x: 0.53, y: 0.22 }, armX: [0.26, 0.31], legFade: [-0.06, 0] },
  12: { slug: "pak-ote-ote", z0: -0.02, stubHi: 0.21, shoulder: { x: 0.27, y: 0.57 }, hand: { x: 0.41, y: 0.3 }, armX: [0.22, 0.27], legFade: [-0.06, 0] },
  0: { slug: "bang-sosis", z0: 0.01, stubHi: 0.21, shoulder: { x: 0.15, y: 0.62 }, hand: { x: 0.4, y: 0.24 }, armX: [0.12, 0.16], legFade: [-0.01, 0.09] },
  4: { slug: "kak-pisang", z0: -0.01, stubHi: 0.25, shoulder: { x: 0.17, y: 0.62 }, hand: { x: 0.41, y: 0.3 }, armX: [0.12, 0.16], legFade: [-0.01, 0.07] },
  5: { slug: "dek-lilin", z0: 0, stubHi: 0.19, shoulder: { x: 0.19, y: 0.56 }, hand: { x: 0.39, y: 0.22 }, armX: [0.15, 0.19], legFade: [-0.06, 0] },
  6: { slug: "bung-jagung", z0: -0.01, stubHi: 0.18, hipY: 0.24, shoulder: { x: 0.19, y: 0.6 }, hand: { x: 0.37, y: 0.29 }, armX: [0.15, 0.19], legFade: [-0.06, 0] },
};

// Skala model ke satuan game, dan titik-titik sendi yang sama untuk semua model.
const K = 1.6;
const GROUND = -0.085; // dasar sepatu, sama dengan sepatu buatan kode
const STUB_LO = 0.12; // pergelangan: dari sini ke atas betis dipanjangkan
const HIP_Y = 0.31; // tinggi pinggul setelah betis dipanjangkan
const ANKLE_Y = 0.12;
const LEG_X = 0.065; // jarak tengah kaki dari sumbu
const SPINE_PIVOT = 0.42; // sama dengan HIP_Y di foodchar.ts

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Kaki asli model cuma tonjolan pendek di atas sepatu: panjangkan supaya bisa menekuk.
function remapY(y: number, stubHi: number, hip: number): number {
  const add = hip - stubHi;
  if (y <= STUB_LO) return y;
  if (y >= stubHi) return y + add;
  return STUB_LO + (y - STUB_LO) * (1 + add / (stubHi - STUB_LO));
}

function build(scene: THREE.Object3D, rig: Rig): AiBody | null {
  const hip = rig.hipY ?? HIP_Y;
  const knee = (hip + ANKLE_Y) / 2;
  const add = hip - rig.stubHi;
  const SHOULDER = { x: rig.shoulder.x, y: rig.shoulder.y + add };
  const HAND = { x: rig.hand.x, y: rig.hand.y + add };
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
    const z = v.z - rig.z0;
    const y = remapY(v.y, rig.stubHi, hip);
    const left = x > 0; // sisi kiri game ada di z negatif = x model positif

    // Tangan: jarak ke garis bahu-ujung tangan.
    const t = Math.min(1, Math.max(0, ((ax - SHOULDER.x) * dx + (y - SHOULDER.y) * dy) / len2));
    const dist = Math.hypot(ax - (SHOULDER.x + dx * t), y - (SHOULDER.y + dy * t), z * 0.5);
    const mArm = (1 - ss(0.08, 0.12, dist)) * ss(rig.armX[0], rig.armX[1], ax) * (y < SHOULDER.y + 0.2 ? 1 : 0);
    // Kaki: bagian bawah, dekat sumbu, dan bukan tangan.
    const mLeg = (1 - ss(hip + rig.legFade[0], hip + rig.legFade[1], y)) * (1 - ss(0.17, 0.21, ax)) * (1 - ss(0.09, 0.13, Math.abs(ax - LEG_X))) * (1 - mArm) * (y <= 0.14 ? 1 : 1 - ss(0.1, 0.14, Math.abs(z)));

    w.fill(0);
    const armTorso = 1 - ss(0, 0.2, t);
    const el = ss(0.38, 0.62, t);
    const armShare = mArm * (1 - armTorso);
    w[left ? BONE.armL : BONE.armR] = armShare * (1 - el);
    w[left ? BONE.elbowL : BONE.elbowR] = armShare * el;
    const sideL = ss(-0.03, 0.03, x);
    const foot = 1 - ss(ANKLE_Y, ANKLE_Y + 0.04, y);
    const hipW = ss(knee - 0.045, knee + 0.045, y);
    const kneeW = (1 - foot) * (1 - hipW);
    w[BONE.footL] += mLeg * sideL * foot;
    w[BONE.kneeL] += mLeg * sideL * kneeW;
    w[BONE.legL] += mLeg * sideL * (1 - foot) * hipW;
    w[BONE.footR] += mLeg * (1 - sideL) * foot;
    w[BONE.kneeR] += mLeg * (1 - sideL) * kneeW;
    w[BONE.legR] += mLeg * (1 - sideL) * (1 - foot) * hipW;
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

  const hipY = hip * K + GROUND;
  const shY = SHOULDER.y * K + GROUND;
  const elMidX = (SHOULDER.x + HAND.x) / 2;
  const elMidY = (SHOULDER.y + HAND.y) / 2;
  const mat = Array.isArray(src.material) ? src.material[0] : src.material;
  return {
    geometry: g,
    map: (mat as THREE.MeshStandardMaterial).map ?? null,
    joints: {
      hipY,
      hipZ: LEG_X * K,
      kneeDy: (hip - knee) * K,
      footDy: (knee - ANKLE_Y) * K,
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
  const rig = RIGS[charId];
  if (!rig) return Promise.resolve(null);
  let p = pending.get(charId);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/chars/${rig.slug}.glb`)
      .then((gltf) => {
        const body = build(gltf.scene, rig);
        if (body) ready.set(charId, body);
        return body;
      })
      .catch(() => null);
    pending.set(charId, p);
  }
  return p;
}
