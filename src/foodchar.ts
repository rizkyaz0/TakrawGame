import * as THREE from "three";
import { Animator, clamp, lerp, type AnimKind } from "./animator";
import { CHARS, type Player } from "./sim";
import { addOutline, toon } from "./style";
import { aiBodyIfReady, loadAiBody, type AiBody } from "./aibody";

// Karakter maskot jajanan: badan besar berbentuk makanan dengan wajah langsung di
// badannya, plus tangan dan kaki "karet" yang tipis dan bisa melar jauh.
// Model menghadap +x; ayunan sendi adalah rotasi sumbu z (positif = ke depan).

type BodyKind =
  | "sosis"
  | "lontong"
  | "bakso"
  | "tahu"
  | "pisang"
  | "eslilin"
  | "jagung"
  | "sate"
  | "klepon"
  | "kerupuk"
  | "tempe"
  | "cendol"
  | "oteote";

// Urutannya sama dengan CHARS di sim.ts.
const KINDS: readonly BodyKind[] = [
  "sosis",
  "lontong",
  "bakso",
  "tahu",
  "pisang",
  "eslilin",
  "jagung",
  "sate",
  "klepon",
  "kerupuk",
  "tempe",
  "cendol",
  "oteote",
];

const HIP_Y = 0.42;
// Skin "warna lain" untuk badan model AI: pewarna yang dikalikan ke teksturnya.
const AI_TINT: Record<number, number> = { 0: 0x9ab4ff, 1: 0xffc8a0, 2: 0xa0c8ff, 3: 0xd0a0ff, 4: 0xff9ad0, 5: 0xffc2a0, 6: 0xa0ffd0, 7: 0xa0d0ff, 8: 0xffa0c8, 9: 0xa0ffc0, 10: 0xffb0a0, 11: 0xd0b0ff, 12: 0xa0ffc8 };
const THIGH = 0.2;
const SHIN = 0.2;
const UPPER_ARM = 0.2;
const FOREARM = 0.2;
const MODEL_SCALE = 1.15;
const LEG_LEN = (THIGH + SHIN + 0.05) * MODEL_SCALE;
const LIMB = 0x2a2733;
const FLIP_Y = 0.95;

// Kotak dengan sudut membulat: tiap titik ditarik ke kotak dalam lalu didorong keluar sejauh r.
function roundedBox(w: number, h: number, d: number, r: number, seg = 5): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, -w / 2 + r, w / 2 - r), clamp(v.y, -h / 2 + r, h / 2 - r), clamp(v.z, -d / 2 + r, d / 2 - r));
    n.copy(v).sub(c);
    if (n.lengthSq() < 1e-10) n.fromBufferAttribute(nor, i);
    n.normalize();
    pos.setXYZ(i, c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

// Gaya v2 (lembar karakter pemilik): lengan dan kaki sewarna badan, tangan berjari,
// sepatu kets, ransel, wajah lebih ekspresif. Karakter yang belum diubah tetap bergaya lama.
interface StyleV2 {
  limb: number; // warna lengan dan kaki
  shoe: number; // warna badan sepatu
  pack: number; // warna ransel
}

export interface BodySpec {
  v2?: StyleV2;
  faceX: number; // posisi wajah di permukaan depan badan
  faceY: number;
  faceSize: number;
  armY: number;
  armZ: number;
  legZ: number;
}

export class FoodCharacter {
  readonly root = new THREE.Group();
  readonly charId: number;
  readonly skinId: number; // 0 bawaan, 1 warna lain, 2 tema (lihat skins.ts)
  readonly spec!: BodySpec; // ukuran dan posisi wajah badan ini (dipakai penonton)

  private model = new THREE.Group();
  private flip = new THREE.Group(); // titik putar salto, di tengah badan
  private body = new THREE.Group();
  readonly spine = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private skin: THREE.MeshToonMaterial;
  private limbSkin: THREE.MeshToonMaterial | null = null; // bahan lengan-kaki v2 (ikut menyala saat jurus)
  private pupils: THREE.Mesh[] = [];
  private pupilY = 0;
  private wobble: THREE.Object3D[] = []; // hiasan di kepala yang ikut bergoyang
  private wobbleAngle = 0;
  private wobbleVel = 0;
  private footL: THREE.Group | null = null; // tulang telapak kaki (hanya untuk badan model AI)
  private footR: THREE.Group | null = null;
  private aiSkin: THREE.MeshToonMaterial | null = null;
  private disposed = false;
  private accessory: THREE.Group | null = null; // hiasan kepala skin tema
  // Kaki karet boleh melar jauh, jadi jangkauannya lebih besar dari karakter biasa.
  private animator = new Animator(HIP_Y * MODEL_SCALE, LEG_LEN, 3.2);

  // bare = hanya badan jajanannya (tanpa wajah, tangan, kaki): dipakai untuk membuat gambar
  // acuan model 3D, dan nanti sebagai pengganti badan kalau badannya diganti model hasil AI.
  constructor(charId: number, bare = false, skinId = 0) {
    this.charId = charId;
    this.skinId = skinId;
    const def = CHARS[charId];
    const kind = KINDS[charId % KINDS.length];
    const accent = toon(def.color);
    const limbMat = toon(LIMB);
    const glove = toon(0xfffaf0);

    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.018): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      if (outline > 0) addOutline(m, outline);
      return m;
    };

    this.root.add(this.model);
    this.model.add(this.flip);
    this.flip.position.y = FLIP_Y;
    this.flip.add(this.body);
    this.body.position.y = -FLIP_Y;
    this.spine.position.y = HIP_Y;
    this.body.add(this.spine);

    this.skin = toon(0xffffff);
    const spec = this.buildBody(kind, part, accent);
    (this as { spec: BodySpec }).spec = spec;
    if (bare) {
      this.model.scale.setScalar(MODEL_SCALE);
      return;
    }

    // Wajah: mata besar yang pupilnya mengikuti bola, alis, dan mulut.
    const ink = new THREE.MeshBasicMaterial({ color: 0x17131c });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const v2 = spec.v2;
    const fs = spec.faceSize * (v2 ? 1.1 : 1);
    for (const z of [-0.14 * fs, 0.14 * fs]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.115 * fs, 14, 12), white);
      eye.scale.set(0.3, 1.25, 0.95);
      eye.position.set(spec.faceX, spec.faceY, z);
      this.spine.add(eye);
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.115 * fs, 14, 12), ink);
      rim.scale.set(0.2, 1.37, 1.08);
      rim.position.set(spec.faceX - 0.012, spec.faceY, z);
      this.spine.add(rim);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06 * fs, 10, 8), ink);
      pupil.scale.set(0.3, 1.25, 1);
      pupil.position.set(spec.faceX + 0.024 * fs, spec.faceY, z);
      this.spine.add(pupil);
      this.pupils.push(pupil);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022 * fs, 6, 6), white);
      glint.position.set(0.012, 0.03 * fs, 0.02 * fs);
      glint.scale.set(1 / 0.3, 1 / 1.25, 1);
      pupil.add(glint);
      const brow = new THREE.Mesh(
        new THREE.BoxGeometry(v2 ? 0.03 : 0.02, (v2 ? 0.05 : 0.035) * fs, (v2 ? 0.21 : 0.17) * fs),
        ink,
      );
      brow.position.set(spec.faceX + 0.01, spec.faceY + 0.2 * fs, z);
      brow.rotation.x = z > 0 ? 0.4 : -0.4;
      this.spine.add(brow);
    }
    this.pupilY = spec.faceY;
    if (v2) {
      // Mulut terbuka: setengah lingkaran gelap dengan lidah merah muda.
      const open = new THREE.Mesh(new THREE.CircleGeometry(0.095 * fs, 18, Math.PI, Math.PI), new THREE.MeshBasicMaterial({ color: 0x4a1220 }));
      open.rotation.y = Math.PI / 2;
      open.position.set(spec.faceX + 0.012, spec.faceY - 0.13 * fs, 0);
      this.spine.add(open);
      const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.06 * fs, 14, Math.PI, Math.PI), new THREE.MeshBasicMaterial({ color: 0xff7f8e }));
      tongue.rotation.y = Math.PI / 2;
      tongue.scale.y = 0.7;
      tongue.position.set(spec.faceX + 0.016, spec.faceY - 0.185 * fs, 0);
      this.spine.add(tongue);
    } else {
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075 * fs, 0.016 * fs, 6, 12, Math.PI), ink);
      mouth.rotation.set(0, Math.PI / 2, Math.PI);
      mouth.position.set(spec.faceX + 0.012, spec.faceY - 0.17 * fs, 0);
      this.spine.add(mouth);
    }
    for (const z of [-(v2 ? 0.21 : 0.26) * fs, (v2 ? 0.21 : 0.26) * fs]) {
      const cheek = new THREE.Mesh(
        new THREE.CircleGeometry((v2 ? 0.07 : 0.05) * fs, 14),
        new THREE.MeshBasicMaterial({ color: 0xff7a7a, transparent: true, opacity: v2 ? 0.75 : 0.55 }),
      );
      cheek.rotation.y = Math.PI / 2;
      cheek.position.set(spec.faceX + 0.005, spec.faceY - (v2 ? 0.2 : 0.11) * fs, z);
      this.spine.add(cheek);
    }

    if (v2) {
      this.limbSkin = toon(v2.limb);
    }
    // Kaki karet dengan sepatu besar warna tim.
    const buildLeg = (hip: THREE.Group, knee: THREE.Group, z: number) => {
      hip.position.set(0, HIP_Y, z);
      const lm = this.limbSkin ?? limbMat;
      const thigh = part(new THREE.CapsuleGeometry(v2 ? 0.058 : 0.045, THIGH, 4, 8), lm, 0.012);
      thigh.position.y = -THIGH / 2;
      hip.add(thigh);
      knee.position.y = -THIGH;
      const shin = part(new THREE.CapsuleGeometry(v2 ? 0.054 : 0.042, SHIN, 4, 8), lm, 0.012);
      shin.position.y = -SHIN / 2;
      knee.add(shin);
      if (v2) {
        knee.add(this.buildSneaker(v2.shoe, part));
      } else {
        const shoe = part(new THREE.SphereGeometry(0.1, 12, 10), accent);
        shoe.scale.set(1.6, 0.75, 1);
        shoe.position.set(0.07, -SHIN - 0.03, 0);
        knee.add(shoe);
      }
      hip.add(knee);
      this.body.add(hip);
    };
    buildLeg(this.legL, this.kneeL, -spec.legZ);
    buildLeg(this.legR, this.kneeR, spec.legZ);

    // Tangan karet dengan sarung tangan putih.
    const buildArm = (shoulder: THREE.Group, elbow: THREE.Group, z: number) => {
      shoulder.position.set(0, spec.armY, z);
      const am = this.limbSkin ?? limbMat;
      const upper = part(new THREE.CapsuleGeometry(v2 ? 0.055 : 0.04, UPPER_ARM, 4, 8), am, 0.012);
      upper.position.y = -UPPER_ARM / 2;
      shoulder.add(upper);
      elbow.position.y = -UPPER_ARM;
      const fore = part(new THREE.CapsuleGeometry(v2 ? 0.052 : 0.038, FOREARM, 4, 8), am, 0.012);
      fore.position.y = -FOREARM / 2;
      elbow.add(fore);
      if (v2) {
        const hand = this.buildGlove(glove, part);
        hand.position.y = -FOREARM - 0.01;
        elbow.add(hand);
      } else {
        const hand = part(new THREE.SphereGeometry(0.085, 10, 8), glove);
        hand.position.y = -FOREARM - 0.05;
        elbow.add(hand);
      }
      shoulder.add(elbow);
      this.spine.add(shoulder);
    };
    buildArm(this.armL, this.elbowL, -spec.armZ);
    buildArm(this.armR, this.elbowR, spec.armZ);

    if (v2) this.buildBackpack(spec, v2.pack, part);
    this.applySkin(spec);
    this.model.scale.setScalar(MODEL_SCALE);

    // Karakter yang punya model AI: dipasang begitu modelnya siap, kode di atas jadi cadangan.
    const ready = aiBodyIfReady(charId);
    if (ready) this.applyAi(ready);
    else
      void loadAiBody(charId).then((b) => {
        if (b && !this.disposed) this.applyAi(b);
      });
  }

  // Skin: 1 = putar warna badan; 2 = hiasan kepala bertema (dipilih dari nomor karakter).
  private applySkin(spec: BodySpec): void {
    if (this.skinId === 1) {
      const seen = new Set<THREE.Material>();
      this.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.name === "outline") return;
        const mat = o.material as THREE.MeshToonMaterial;
        if (!(mat instanceof THREE.MeshToonMaterial) || seen.has(mat)) return;
        seen.add(mat);
        mat.color.offsetHSL(0.45, 0.05, 0);
      });
    } else if (this.skinId === 2) {
      this.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.spine);
      this.accessory = this.buildAccessory(spec.armZ * 0.62);
      this.accessory.position.set((box.min.x + box.max.x) / 2, box.max.y - HIP_Y - 0.06, 0);
      this.spine.add(this.accessory);
    }
  }

  private buildAccessory(r: number): THREE.Group {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, toon(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.keep = true;
      addOutline(m, 0.012).userData.keep = true;
      m.children[m.children.length - 1].userData.keep = true;
      g.add(m);
      return m;
    };
    const theme = this.charId % 3;
    if (theme === 0) {
      // 17-an: peci hitam dengan bendera merah putih kecil.
      add(new THREE.CylinderGeometry(r * 0.86, r * 0.95, 0.22, 16), 0x1c1a22, 0, 0.1);
      add(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.04, 16), 0xe5392d, 0, 0.03);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 5), 0xfffaf0, r * 0.6, 0.3, 0);
      add(new THREE.BoxGeometry(0.02, 0.1, 0.16), 0xe5392d, r * 0.6, 0.45, 0.09);
      add(new THREE.BoxGeometry(0.02, 0.1, 0.16), 0xfffaf0, r * 0.6, 0.35, 0.09);
    } else if (theme === 1) {
      // Pantai: topi jerami lebar dengan pita.
      add(new THREE.CylinderGeometry(r * 1.9, r * 1.9, 0.04, 20), 0xe9c06a, 0, 0.02);
      add(new THREE.CylinderGeometry(r * 0.85, r * 1.0, 0.18, 16), 0xf0cf7c, 0, 0.12);
      add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.05, 16), 0x2fb4d6, 0, 0.06);
    } else {
      // Malam Minggu: topi baseball neon dengan bintang di depan.
      add(new THREE.SphereGeometry(r * 1.02, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x6a3df0, 0, 0.02);
      const visor = add(new THREE.BoxGeometry(r * 1.2, 0.04, r * 1.5), 0xff4fa3, r * 1.0, 0.03, 0);
      visor.rotation.z = -0.15;
      add(new THREE.OctahedronGeometry(0.06), 0xffd23f, r * 0.7, 0.2, 0);
    }
    return g;
  }

  // Ganti badan buatan kode dengan model AI yang dikuliti ke sendi-sendi yang sama.
  private applyAi(ai: AiBody): void {
    if (this.aiSkin) return;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.keep) o.visible = false;
    });
    if (this.accessory) {
      ai.geometry.computeBoundingBox();
      this.accessory.position.set(0, ai.geometry.boundingBox!.max.y - HIP_Y - 0.06, 0);
    }
    const J = ai.joints;
    this.legL.position.set(0, J.hipY, -J.hipZ);
    this.legR.position.set(0, J.hipY, J.hipZ);
    this.kneeL.position.set(0, -J.kneeDy, 0);
    this.kneeR.position.set(0, -J.kneeDy, 0);
    this.footL = new THREE.Group();
    this.footR = new THREE.Group();
    this.footL.position.y = -J.footDy;
    this.footR.position.y = -J.footDy;
    this.kneeL.add(this.footL);
    this.kneeR.add(this.footR);
    this.armL.position.set(0, J.shoulderY, -J.shoulderZ);
    this.armR.position.set(0, J.shoulderY, J.shoulderZ);
    this.elbowL.position.set(0, J.elbowDy, -J.elbowDz);
    this.elbowR.position.set(0, J.elbowDy, J.elbowDz);

    const bones = [
      this.spine,
      this.legL,
      this.kneeL,
      this.footL,
      this.legR,
      this.kneeR,
      this.footR,
      this.armL,
      this.elbowL,
      this.armR,
      this.elbowR,
    ];
    // Rangka dipasang dalam pose diam, apa pun pose saat ini.
    const saved = bones.map((b) => [b.rotation.clone(), b.scale.clone()] as const);
    for (const b of bones) {
      b.rotation.set(0, 0, 0);
      b.scale.set(1, 1, 1);
    }
    const mat = toon(this.skinId === 1 ? (AI_TINT[this.charId] ?? 0xffb0e0) : 0xffffff, { map: ai.map, side: THREE.DoubleSide });
    this.aiSkin = mat;
    const mesh = new THREE.SkinnedMesh(ai.geometry, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.body.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones as unknown as THREE.Bone[]));
    addOutline(mesh, 0.01);
    bones.forEach((b, i) => {
      b.rotation.copy(saved[i][0]);
      b.scale.copy(saved[i][1]);
    });
  }

  // Sarung tangan putih besar: manset, telapak, tiga jari, dan jempol.
  private buildGlove(
    mat: THREE.Material,
    part: (geo: THREE.BufferGeometry, mat: THREE.Material, outline?: number) => THREE.Mesh,
  ): THREE.Group {
    const g = new THREE.Group();
    const cuff = part(new THREE.CylinderGeometry(0.078, 0.072, 0.075, 12), mat, 0.012);
    cuff.position.y = 0.01;
    g.add(cuff);
    const palm = part(new THREE.SphereGeometry(0.1, 14, 10), mat, 0.014);
    palm.scale.set(0.78, 1.0, 1.1);
    palm.position.y = -0.1;
    g.add(palm);
    for (const [z, len, ang] of [[-0.055, 0.085, 0.3], [0, 0.1, 0], [0.055, 0.085, -0.3]] as const) {
      const f = part(new THREE.CapsuleGeometry(0.027, len, 3, 6), mat, 0.01);
      f.position.set(0, -0.205, z);
      f.rotation.x = ang;
      g.add(f);
    }
    const thumb = part(new THREE.CapsuleGeometry(0.03, 0.075, 3, 6), mat, 0.01);
    thumb.position.set(0.085, -0.13, 0);
    thumb.rotation.z = -0.75;
    g.add(thumb);
    return g;
  }

  // Sepatu kets: sol putih, badan berwarna, ujung putih, kerah, dan tali. Dasar sepatu
  // tepat di tempat yang sama dengan sepatu lama, jadi posisi berdiri tidak berubah.
  private buildSneaker(
    color: number,
    part: (geo: THREE.BufferGeometry, mat: THREE.Material, outline?: number) => THREE.Mesh,
  ): THREE.Group {
    const g = new THREE.Group();
    const white = toon(0xfffaf0);
    const upperMat = toon(color);
    const sole = part(roundedBox(0.3, 0.05, 0.18, 0.022, 3), white, 0.012);
    sole.position.set(0.065, 0.025, 0);
    g.add(sole);
    const upper = part(new THREE.SphereGeometry(0.1, 14, 10), upperMat, 0.014);
    upper.scale.set(1.35, 0.9, 0.88);
    upper.position.set(0.05, 0.125, 0);
    g.add(upper);
    const toe = part(new THREE.SphereGeometry(0.07, 12, 8), white, 0.012);
    toe.scale.set(1.1, 0.8, 1.15);
    toe.position.set(0.15, 0.085, 0);
    g.add(toe);
    const collar = part(new THREE.TorusGeometry(0.068, 0.022, 6, 14), white, 0.01);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(-0.005, 0.205, 0);
    g.add(collar);
    for (const [x, y] of [[0.045, 0.215], [0.085, 0.205], [0.125, 0.185]] as const) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.1), white);
      lace.position.set(x, y, 0);
      lace.rotation.z = -0.25;
      g.add(lace);
    }
    g.scale.setScalar(1.25);
    g.position.y = -SHIN - 0.105;
    return g;
  }

  // Ransel kecil di punggung dengan tali di sisi badan; ukurannya mengikuti lebar badan.
  private buildBackpack(
    spec: BodySpec,
    color: number,
    part: (geo: THREE.BufferGeometry, mat: THREE.Material, outline?: number) => THREE.Mesh,
  ): void {
    const W = spec.armZ * 1.0;
    const H = 0.38;
    const D = 0.15;
    const g = new THREE.Group();
    const main = toon(color);
    const dark = toon(new THREE.Color(color).multiplyScalar(0.72).getHex());
    const body = part(roundedBox(D, H, W, 0.05), main, 0.016);
    g.add(body);
    const flap = part(roundedBox(D + 0.025, H * 0.42, W + 0.012, 0.04), dark, 0.012);
    flap.position.y = H * 0.3;
    g.add(flap);
    const pocket = part(roundedBox(D + 0.045, H * 0.3, W * 0.7, 0.03), main, 0.012);
    pocket.position.y = -H * 0.22;
    g.add(pocket);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(D + 0.06, 0.05, 0.04), toon(0x17131c));
    buckle.position.y = H * 0.08;
    g.add(buckle);
    const handle = part(new THREE.TorusGeometry(0.05, 0.014, 5, 10, Math.PI), toon(0x17131c), 0.008);
    handle.rotation.set(0, Math.PI / 2, 0);
    handle.position.y = H / 2;
    g.add(handle);
    g.position.set(-(spec.faceX + D * 0.42), spec.armY - 0.04, 0);
    this.spine.add(g);
    // Tali: dua batang gelap di tepi badan setinggi dada.
    const strap = toon(0x17131c);
    for (const sz of [-1, 1]) {
      const bar = part(new THREE.CapsuleGeometry(0.018, 0.26, 3, 6), strap, 0.008);
      bar.position.set(spec.faceX * 0.5, spec.armY + 0.06, sz * spec.armZ * 0.86);
      bar.rotation.x = sz * 0.12;
      this.spine.add(bar);
    }
  }

  // Tiap jajanan punya bentuk badan, warna, dan hiasan sendiri.
  private buildBody(
    kind: BodyKind,
    part: (geo: THREE.BufferGeometry, mat: THREE.Material, outline?: number) => THREE.Mesh,
    accent: THREE.Material,
  ): BodySpec {
    const add = (m: THREE.Object3D, x: number, y: number, z = 0): THREE.Object3D => {
      m.position.set(x, y, z);
      this.spine.add(m);
      return m;
    };
    const skin = this.skin;

    switch (kind) {
      case "sosis": {
        // Sosis bakar: kapsul merah kecokelatan dengan garis panggangan dan simpul di ujung.
        // Gaya v2: sosis merah halus berkupluk merah tua dengan simpul di ujungnya.
        skin.color.setHex(0xe4483a);
        add(part(new THREE.CapsuleGeometry(0.31, 0.68, 8, 22), skin, 0.022), 0, 0.6);
        const hat = toon(0xa01f2c);
        add(part(new THREE.SphereGeometry(0.335, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), hat, 0.02), 0, 0.99);
        const brim = part(new THREE.TorusGeometry(0.325, 0.068, 10, 26), toon(0xb8262f), 0.016);
        brim.rotation.x = Math.PI / 2;
        brim.scale.z = 0.8;
        add(brim, 0, 0.985);
        const knot = add(part(new THREE.SphereGeometry(0.1, 12, 10), hat, 0.016), 0, 1.33);
        knot.scale.set(1, 0.85, 1);
        this.wobble.push(knot);
        return {
          faceX: 0.3,
          faceY: 0.68,
          faceSize: 0.95,
          armY: 0.5,
          armZ: 0.33,
          legZ: 0.13,
          v2: { limb: 0xe4483a, shoe: 0xb52a30, pack: 0x2f6b4f },
        };
      }
      case "lontong": {
        // Gaya v2: tabung hijau halus berkerah terang, kantong daun hijau tua diikat di atas.
        skin.color.setHex(0x84c03c);
        add(part(new THREE.CylinderGeometry(0.31, 0.33, 1.0, 24), skin, 0.022), 0, 0.5);
        add(part(new THREE.SphereGeometry(0.33, 20, 10), skin, 0.02), 0, 0.06).scale.set(1, 0.4, 1);
        add(part(new THREE.CylinderGeometry(0.345, 0.345, 0.14, 24), toon(0x95cf4a), 0.018), 0, 0.98);
        const leaf = toon(0x3f8a3c);
        const pouch = part(new THREE.SphereGeometry(0.31, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), leaf, 0.02);
        add(pouch, 0, 1.03).scale.set(1, 0.95, 1);
        const tie = part(new THREE.TorusGeometry(0.075, 0.022, 6, 12), toon(0x2fa090), 0.01);
        tie.rotation.x = Math.PI / 2;
        add(tie, 0, 1.34);
        const tip = part(new THREE.SphereGeometry(0.1, 12, 10), leaf, 0.014);
        tip.scale.set(1, 1.25, 1);
        this.wobble.push(add(tip, 0, 1.4));
        return {
          faceX: 0.31,
          faceY: 0.64,
          faceSize: 0.95,
          armY: 0.48,
          armZ: 0.34,
          legZ: 0.14,
          v2: { limb: 0x3f7f33, shoe: 0x35a64a, pack: 0x5a3a2e },
        };
      }
      case "oteote": {
        // Ote-ote: gorengan bulat keemasan berbintil renyah dengan topi cokelat.
        skin.color.setHex(0xd9a84a);
        const blob = add(part(new THREE.SphereGeometry(0.42, 24, 18), skin, 0.022), 0, 0.5);
        blob.scale.set(1, 1.22, 0.96);
        const crisp = toon(0xb8782a);
        for (let k = 0; k < 28; k++) {
          const h = Math.imul(k + 9, 2654435761) >>> 0;
          const th = ((h % 1000) / 1000) * Math.PI * 2;
          const ph = 0.5 + (((h >>> 10) % 1000) / 1000) * 1.9;
          const bx = Math.sin(ph) * Math.cos(th) * 0.42;
          const bz = Math.sin(ph) * Math.sin(th) * 0.4;
          if (bx > 0.18 && Math.abs(bz) < 0.3) continue; // bagian wajah dibiarkan polos
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), crisp);
          b.scale.set(1, 0.8, 0.7);
          add(b, bx, 0.5 + Math.cos(ph) * 0.5, bz);
        }
        const cap = part(new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x6a3d22), 0.018);
        cap.scale.y = 0.7;
        add(cap, 0, 0.96);
        return {
          faceX: 0.4,
          faceY: 0.58,
          faceSize: 0.95,
          armY: 0.5,
          armZ: 0.4,
          legZ: 0.15,
          v2: { limb: 0xc98e3a, shoe: 0x6a3d22, pack: 0x2f6b4f },
        };
      }
      case "bakso": {
        // Gaya v2: bakso cokelat berbintil, berikat kepala dan caping anyaman, berkumis.
        skin.color.setHex(0x9b6a4f);
        add(part(new THREE.SphereGeometry(0.52, 26, 20), skin, 0.024), 0, 0.52);
        const bump = toon(0xb97a62);
        for (let k = 0; k < 30; k++) {
          const h = Math.imul(k + 5, 2654435761) >>> 0;
          const th = ((h % 1000) / 1000) * Math.PI * 2;
          const ph = 0.55 + (((h >>> 10) % 1000) / 1000) * 1.85;
          const bx = Math.sin(ph) * Math.cos(th) * 0.52;
          const bz = Math.sin(ph) * Math.sin(th) * 0.52;
          if (bx > 0.2 && Math.abs(bz) < 0.4) continue; // bagian wajah dibiarkan polos
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), bump);
          b.scale.set(1, 1, 0.6);
          add(b, bx, 0.52 + Math.cos(ph) * 0.52, bz);
        }
        const band = part(new THREE.TorusGeometry(0.375, 0.062, 8, 26), toon(0xb4652c), 0.014);
        band.rotation.x = Math.PI / 2;
        add(band, 0, 0.9);
        const tail = part(new THREE.ConeGeometry(0.05, 0.22, 6), toon(0xb4652c), 0.01);
        tail.geometry.translate(0, -0.11, 0);
        this.wobble.push(add(tail, -0.36, 0.9, 0.12));
        const hatMat = toon(0xdcae62);
        add(part(new THREE.ConeGeometry(0.44, 0.3, 20), hatMat, 0.018), 0, 1.03);
        const weave = toon(0xb88a3a);
        for (const [y, r] of [[0.96, 0.33], [1.03, 0.22], [1.1, 0.11]] as const) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 22), weave);
          ring.rotation.x = Math.PI / 2;
          add(ring, 0, y);
        }
        const stache = toon(0x3a2418);
        for (const sz of [-1, 1]) {
          const m = part(new THREE.SphereGeometry(0.07, 10, 8), stache, 0.01);
          m.scale.set(0.45, 0.6, 1.9);
          m.rotation.x = sz * 0.3;
          add(m, 0.5, 0.445, sz * 0.1);
        }
        return {
          faceX: 0.5,
          faceY: 0.58,
          faceSize: 1.05,
          armY: 0.5,
          armZ: 0.52,
          legZ: 0.2,
          v2: { limb: 0x8e5e45, shoe: 0x7a4a2e, pack: 0x8a1f35 },
        };
      }
      case "tahu": {
        // Gaya v2: tahu goreng keemasan berpori, berikat kepala batik dengan simpul kain di atas.
        skin.color.setHex(0xf0b72f);
        add(part(roundedBox(0.66, 0.9, 0.66, 0.14), skin, 0.022), 0, 0.5);
        const pore = toon(0xc98a1d);
        for (let k = 0; k < 18; k++) {
          const h = Math.imul(k + 9, 2654435761) >>> 0;
          const side = k % 2 === 0 ? 1 : -1;
          const py = 0.2 + ((h % 1000) / 1000) * 0.6;
          const px = -0.2 + (((h >>> 10) % 1000) / 1000) * 0.4;
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), pore);
          dot.scale.set(1, 0.9, 0.5);
          add(dot, px, py, side * 0.335);
        }
        const batik = part(roundedBox(0.7, 0.13, 0.7, 0.05), toon(0x6b3a22), 0.014);
        add(batik, 0, 0.97);
        const motif = toon(0xd9a05a);
        for (let k = 0; k < 6; k++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.05), motif);
          bar.rotation.x = 0.7;
          add(bar, 0.352, 0.97, -0.25 + k * 0.1);
        }
        const cloth = toon(0xf6cf3f);
        for (const [rz, rx] of [[0, 0], [0.5, 0.35], [-0.5, -0.35]] as const) {
          const l = part(new THREE.ConeGeometry(0.06, 0.2, 5), cloth, 0.01);
          l.geometry.translate(0, 0.1, 0);
          l.rotation.set(rx, 0, rz);
          if (rz === 0) this.wobble.push(add(l, 0, 1.03));
          else add(l, 0, 1.03);
        }
        return {
          faceX: 0.335,
          faceY: 0.56,
          faceSize: 0.95,
          armY: 0.42,
          armZ: 0.35,
          legZ: 0.16,
          v2: { limb: 0xf0a82c, shoe: 0xf26a1b, pack: 0x1f2f66 },
        };
      }
      case "pisang": {
        // Gaya v2: pisang kuning dengan kulit terbuka di perut dan daging buah terlihat.
        skin.color.setHex(0xf6d12e);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-0.12, 0.08, 0),
          new THREE.Vector3(0.34, 0.66, 0),
          new THREE.Vector3(-0.14, 1.26, 0),
        );
        add(part(new THREE.TubeGeometry(curve, 20, 0.25, 14, false), skin, 0.022), 0, 0);
        add(part(new THREE.SphereGeometry(0.25, 14, 10), skin, 0.022), -0.12, 0.08);
        add(part(new THREE.SphereGeometry(0.25, 14, 10), skin, 0.022), -0.14, 1.26);
        const meat = part(new THREE.SphereGeometry(0.2, 18, 12), toon(0xf3e3a2), 0.018);
        meat.scale.set(0.5, 1.7, 1.0);
        add(meat, 0.25, 0.36);
        add(part(new THREE.SphereGeometry(0.05, 8, 6), toon(0x6b4a22), 0.01), 0.31, 0.06);
        const peel = toon(0xc9c93c);
        for (const sz of [-1, 1]) {
          const flap = part(new THREE.ConeGeometry(0.1, 0.5, 5), peel, 0.012);
          flap.scale.z = 0.35;
          flap.rotation.set(sz * 0.75, 0, 0.12);
          add(flap, 0.22, 0.32, sz * 0.26);
        }
        const stem = part(new THREE.CylinderGeometry(0.05, 0.07, 0.24, 6), toon(0x7a7a2a), 0.01);
        stem.geometry.translate(0, 0.12, 0);
        stem.userData.rest = 0.7;
        this.wobble.push(add(stem, -0.26, 1.44));
        return {
          faceX: 0.36,
          faceY: 0.8,
          faceSize: 0.82,
          armY: 0.52,
          armZ: 0.27,
          legZ: 0.12,
          v2: { limb: 0xf2c91e, shoe: 0xd9372f, pack: 0x2f6b4f },
        };
      }
      case "eslilin": {
        // Gaya v2: lilin biru muda dengan lelehan lilin di atas, sumbu, dan api kecil.
        skin.color.setHex(0x9fd4ee);
        add(part(new THREE.CylinderGeometry(0.29, 0.3, 1.0, 24), skin, 0.022), 0, 0.5);
        add(part(new THREE.SphereGeometry(0.3, 18, 8), skin, 0.02), 0, 0.04).scale.set(1, 0.3, 1);
        const wax = toon(0xbfe6f8);
        add(part(new THREE.CylinderGeometry(0.31, 0.3, 0.1, 24), wax, 0.016), 0, 1.0);
        const drips: Array<[number, number]> = [[1.3, 0.12], [2.2, 0.16], [3.1, 0.1], [3.9, 0.15], [4.7, 0.11], [5.6, 0.14]];
        for (const [a, h] of drips) {
          const d = part(new THREE.CapsuleGeometry(0.045, h, 4, 8), wax, 0.01);
          add(d, Math.cos(a) * 0.3, 0.98 - h / 2 - 0.02, Math.sin(a) * 0.3);
        }
        add(part(new THREE.CylinderGeometry(0.014, 0.014, 0.13, 5), toon(0x17131c), 0.006), 0, 1.1);
        // Api berbentuk tetesan: lathe dengan perut di bawah dan ujung runcing di atas.
        const drop: Array<[number, number]> = [[0.001, 0], [0.055, 0.03], [0.085, 0.09], [0.07, 0.17], [0.035, 0.26], [0.001, 0.36]];
        const flame = part(new THREE.LatheGeometry(drop.map(([r, y]) => new THREE.Vector2(r, y)), 14), toon(0xff9a2c), 0.012);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
        core.scale.y = 1.6;
        core.position.set(0.012, 0.09, 0);
        flame.add(core);
        this.wobble.push(add(flame, 0, 1.15));
        return {
          faceX: 0.29,
          faceY: 0.58,
          faceSize: 0.95,
          armY: 0.5,
          armZ: 0.31,
          legZ: 0.13,
          v2: { limb: 0x8cc7ea, shoe: 0x3f73d6, pack: 0xd8352c },
        };
      }
      case "jagung": {
        // Gaya v2: jagung berbiji dengan kelobot hijau di bawah dan rambut jagung cokelat.
        skin.color.setHex(0xf7d03a);
        const profile: Array<[number, number]> = [
          [0.001, 0.0], [0.24, 0.03], [0.3, 0.2], [0.3, 0.7], [0.24, 1.1], [0.13, 1.34], [0.001, 1.42],
        ];
        add(part(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20), skin, 0.022), 0, 0);
        const radiusAt = (y: number) => {
          for (let i = 1; i < profile.length; i++) {
            if (y <= profile[i][1]) {
              const [r0, y0] = profile[i - 1];
              const [r1, y1] = profile[i];
              return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
            }
          }
          return 0.1;
        };
        // Biji-biji: satu InstancedMesh supaya hanya satu panggilan gambar.
        const kernels = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 5), toon(0xf4c022), 170);
        const m4 = new THREE.Matrix4();
        let count = 0;
        for (let row = 0; row < 12; row++) {
          const y = 0.36 + row * 0.077;
          const r = radiusAt(y);
          for (let c = 0; c < 14; c++) {
            const ang = ((c + (row % 2) * 0.5) / 14) * Math.PI * 2;
            const wrapped = Math.atan2(Math.sin(ang), Math.cos(ang));
            if (Math.abs(wrapped) < 0.8 && y > 0.5 && y < 1.08) continue; // bagian wajah dibiarkan polos
            m4.makeTranslation(Math.cos(ang) * (r + 0.012), y, Math.sin(ang) * (r + 0.012));
            kernels.setMatrixAt(count++, m4);
          }
        }
        kernels.count = count;
        kernels.castShadow = true;
        add(kernels, 0, 0);
        const husk = toon(0x5aa63a);
        for (const deg of [-42, 42, -138, 138]) {
          const pivot = new THREE.Group();
          pivot.rotation.y = (-deg * Math.PI) / 180;
          const leaf = part(new THREE.ConeGeometry(0.2, 0.95, 6), husk, 0.014);
          leaf.scale.set(0.35, 1, 1);
          leaf.position.set(0.27, 0.5, 0);
          leaf.rotation.z = -0.22;
          pivot.add(leaf);
          add(pivot, 0, 0);
        }
        const silk = toon(0x6b3d22);
        const tuft = new THREE.Group();
        for (const [rx, rz] of [[0, 0], [0.5, 0.2], [-0.5, 0.2], [0.2, -0.5], [-0.2, -0.5]] as const) {
          const strand = part(new THREE.ConeGeometry(0.025, 0.3, 4), silk, 0.008);
          strand.geometry.translate(0, 0.15, 0);
          strand.rotation.set(rx, 0, rz);
          tuft.add(strand);
        }
        this.wobble.push(add(tuft, 0, 1.4));
        return {
          faceX: 0.3,
          faceY: 0.8,
          faceSize: 0.88,
          armY: 0.52,
          armZ: 0.32,
          legZ: 0.13,
          v2: { limb: 0xf2c21e, shoe: 0x3aa24a, pack: 0xc63a2f },
        };
      }
      case "sate": {
        // Sate: tiga potong daging berbumbu kacang di tusuk bambu yang menjulang.
        skin.color.setHex(0xb5623a);
        const sauce = toon(0x7a3f1e);
        const chunks: Array<[number, number, number]> = [[0.3, 0.3, 0.36], [0.62, 0.34, 0.4], [0.98, 0.3, 0.34]];
        for (const [y, r, h] of chunks) {
          add(part(roundedBox(r * 2, h, r * 1.9, 0.12), skin, 0.022), 0, y + 0.08).rotation.y = y * 1.7;
          const drip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.03, 5, 16), sauce);
          drip.rotation.x = Math.PI / 2;
          add(drip, 0, y + 0.2);
        }
        const stick = part(new THREE.CylinderGeometry(0.022, 0.03, 0.62, 6), toon(0xe3c58a), 0.008);
        stick.geometry.translate(0, 0.31, 0);
        this.wobble.push(add(stick, 0, 1.18));
        add(part(new THREE.CylinderGeometry(0.03, 0.01, 0.2, 6), toon(0xe3c58a), 0.008), 0, 0.04);
        const band = part(new THREE.TorusGeometry(0.33, 0.04, 6, 4), accent, 0.01);
        band.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        add(band, 0, 0.52);
        return { faceX: 0.35, faceY: 0.74, faceSize: 0.9, armY: 0.56, armZ: 0.36, legZ: 0.14 };
      }
      case "klepon": {
        // Klepon: bola hijau pandan bertabur kelapa parut, gula merah meleleh di ubun-ubun.
        skin.color.setHex(0x6fbf4a);
        add(part(new THREE.SphereGeometry(0.5, 24, 18), skin, 0.024), 0, 0.5);
        const flake = toon(0xfffaf0);
        for (let k = 0; k < 26; k++) {
          const h = Math.imul(k + 3, 2654435761) >>> 0;
          const th = ((h % 1000) / 1000) * Math.PI * 2;
          const ph = 0.25 + (((h >>> 10) % 1000) / 1000) * 1.5;
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.02), flake);
          f.rotation.set(th, ph, th * 2);
          add(f, Math.sin(ph) * Math.cos(th) * 0.5, 0.5 + Math.cos(ph) * 0.5, Math.sin(ph) * Math.sin(th) * 0.5);
        }
        add(part(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x8a4a1e), 0.012), 0, 0.93);
        const drop = part(new THREE.SphereGeometry(0.07, 8, 8), toon(0x8a4a1e), 0.01);
        drop.scale.y = 1.6;
        this.wobble.push(add(drop, 0.16, 0.86, 0.12));
        const band = part(new THREE.TorusGeometry(0.5, 0.04, 6, 24), accent, 0.01);
        band.rotation.x = Math.PI / 2;
        add(band, 0, 0.22).scale.setScalar(0.86);
        return { faceX: 0.48, faceY: 0.54, faceSize: 1.15, armY: 0.48, armZ: 0.5, legZ: 0.2 };
      }
      case "kerupuk": {
        // Kerupuk: lempeng lebar bergelombang yang tipis, ringan, dan gampang terbang.
        skin.color.setHex(0xf6e6c0);
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k <= 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          const r = 0.56 + Math.sin(a * 9) * 0.045;
          pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
        }
        const slab = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
        slab.translate(0, 0, -0.08);
        slab.rotateY(Math.PI / 2);
        add(part(slab, skin, 0.022), 0.02, 0.64);
        const swirl = toon(0xe9b95a);
        for (const r of [0.2, 0.34, 0.46]) {
          for (const side of [-1, 1]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 4, 22), swirl);
            ring.rotation.y = Math.PI / 2;
            add(ring, 0.02 + side * 0.125, 0.64);
          }
        }
        const crumb = part(new THREE.SphereGeometry(0.06, 6, 5), toon(0xe9b95a), 0.008);
        this.wobble.push(add(crumb, 0, 1.24));
        const band = part(new THREE.BoxGeometry(0.3, 0.07, 1.06), accent, 0.01);
        add(band, 0.02, 0.2);
        return { faceX: 0.165, faceY: 0.68, faceSize: 0.95, armY: 0.56, armZ: 0.5, legZ: 0.16 };
      }
      case "tempe": {
        // Tempe: balok padat berbintik kedelai, dibungkus daun pisang di bagian bawah.
        skin.color.setHex(0xeadfc6);
        add(part(roundedBox(0.56, 1.02, 0.78, 0.09), skin, 0.022), 0, 0.56);
        const bean = toon(0xd2b06a);
        for (let k = 0; k < 22; k++) {
          const h = Math.imul(k + 7, 2654435761) >>> 0;
          const y = 0.48 + ((h % 100) / 100) * 0.56;
          const z = (((h >>> 8) % 100) / 100 - 0.5) * 0.64;
          const front = k % 3 !== 0;
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), bean);
          b.scale.set(front ? 0.4 : 1, 1.2, front ? 1 : 0.4);
          add(b, front ? 0.283 * (k % 2 ? 1 : -1) : (((h >>> 16) % 100) / 100 - 0.5) * 0.4, y, front ? z : 0.393 * (k % 2 ? 1 : -1));
        }
        add(part(roundedBox(0.6, 0.36, 0.82, 0.08), toon(0x3d8040), 0.016), 0, 0.2);
        const tie = part(new THREE.TorusGeometry(0.36, 0.035, 6, 4), accent, 0.01);
        tie.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        tie.scale.set(0.84, 1.16, 1);
        add(tie, 0, 0.38);
        const sprout = part(new THREE.ConeGeometry(0.07, 0.24, 5), toon(0x4fae5a), 0.01);
        sprout.geometry.translate(0, 0.12, 0);
        sprout.scale.z = 0.4;
        this.wobble.push(add(sprout, 0, 1.07));
        return { faceX: 0.285, faceY: 0.72, faceSize: 0.92, armY: 0.5, armZ: 0.41, legZ: 0.16 };
      }
      case "cendol": {
        // Es cendol: gelas tinggi berisi santan, cendol hijau, dan sedotan.
        skin.color.setHex(0xfbf3df);
        const profile: Array<[number, number]> = [[0.001, 0.02], [0.27, 0.02], [0.3, 0.2], [0.37, 1.08], [0.39, 1.14], [0.001, 1.14]];
        add(part(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20), skin, 0.022), 0, 0);
        const gula = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.275, 0.2, 20), toon(0x9a5a26));
        add(gula, 0, 0.14);
        const cendol = toon(0x58b84a);
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + (k % 3);
          const y = 0.3 + ((k * 37) % 60) / 100;
          const r = 0.305 + (y - 0.2) * 0.075;
          const worm = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.09, 3, 6), cendol);
          worm.rotation.set(k, a, 0.8);
          add(worm, Math.cos(a) * r, y, Math.sin(a) * r);
        }
        add(part(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xeafcff), 0.014), 0, 1.12).scale.y = 0.5;
        const straw = part(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 8), accent, 0.01);
        straw.geometry.translate(0, 0.31, 0);
        straw.userData.rest = -0.3;
        this.wobble.push(add(straw, -0.12, 1.1, 0.1));
        const rim = part(new THREE.TorusGeometry(0.385, 0.025, 6, 22), toon(0xd9f6ff), 0.008);
        rim.rotation.x = Math.PI / 2;
        add(rim, 0, 1.13);
        return { faceX: 0.345, faceY: 0.7, faceSize: 0.92, armY: 0.5, armZ: 0.36, legZ: 0.14 };
      }
    }
  }

  // Pose diam untuk potret: menghadap kamera, satu tangan melambai.
  pose(yaw = -0.7): void {
    this.model.rotation.y = yaw;
    this.armL.rotation.z = 0.5;
    this.armR.rotation.z = 2.7;
    this.elbowR.rotation.z = 0.5;
    this.legL.rotation.z = -0.12;
    this.legR.rotation.z = 0.12;
  }

  // Pose untuk panggung layar judul. kind 0 = salto menendang (tendangan atas dari posisi
  // terbalik), kind 1 = tendangan samping dengan badan condong ke belakang. a = detik sejak aksi
  // dimulai (aksi berlangsung STAGE_ACTION detik, sisanya siaga); t = waktu nyata; yaw = putaran badan.
  poseStage(kind: 0 | 1, a: number, t: number, yaw: number): void {
    const sm = (x: number) => {
      const c = Math.min(1, Math.max(0, x));
      return c * c * (3 - 2 * c);
    };
    // Nilai antar-kunci dengan peralihan halus (ancang-ancang, tolakan, kontak, mendarat).
    const tr = (keys: ReadonlyArray<readonly [number, number]>): number => {
      if (a <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (a <= keys[i][0]) return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * sm((a - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
      }
      return keys[keys.length - 1][1];
    };
    const idle = a < 0 || a > 1.8;
    let hipR = -0.2, kneeR = -0.5, hipL = 0.2, kneeL = -0.4, shL = 0.9, shR = 0.5, lift = 0, flip = 0, lean = 0.05, twist = 0, squash = 0, stretch = 1, wig = 0;
    if (idle) {
      const b = Math.sin(t * 4.2 + yaw * 2);
      lift = 0.015 + b * 0.02;
      kneeL = -0.4 - b * 0.06;
      kneeR = -0.5 - b * 0.06;
      shL = 0.9 + b * 0.12;
      shR = 0.5 - b * 0.12;
    } else if (kind === 0) {
      hipR = tr([[0, -0.2], [0.3, 0.7], [0.5, 1.6], [0.8, 1.2], [0.95, 2.35], [1.15, 0.6], [1.45, -0.3], [1.8, -0.2]]);
      kneeR = tr([[0, -0.5], [0.3, -1.4], [0.5, -2.0], [0.8, -1.8], [0.95, -0.05], [1.15, -1.0], [1.45, -0.8], [1.8, -0.5]]);
      hipL = tr([[0, 0.2], [0.3, 0.8], [0.6, 1.5], [1.0, 1.0], [1.4, 0.4], [1.8, 0.2]]);
      kneeL = tr([[0, -0.4], [0.3, -1.2], [0.6, -1.9], [1.0, -1.2], [1.4, -0.9], [1.8, -0.4]]);
      shL = tr([[0, 0.9], [0.3, -0.9], [0.55, 1.8], [1.0, 0.6], [1.8, 0.9]]);
      shR = tr([[0, 0.5], [0.3, -1.0], [0.55, -1.4], [1.0, -0.6], [1.8, 0.5]]);
      lift = tr([[0, 0], [0.25, -0.14], [0.35, 0], [0.7, 0.95], [1.0, 1.3], [1.3, 0.55], [1.45, -0.08], [1.6, 0], [1.8, 0]]);
      flip = Math.PI * 2 * sm((a - 0.35) / 1.0); // salto ke belakang; kontak saat terbalik
      squash = a > 1.3 ? Math.sin(((Math.min(a, 1.7) - 1.3) / 0.4) * Math.PI) * 0.1 : a < 0.3 ? Math.sin((a / 0.3) * Math.PI) * 0.1 : 0;
      stretch = 1 + 0.35 * Math.max(0, 1 - Math.abs(a - 0.95) / 0.15);
      // Badan ikut melengkung: melengkung ke belakang saat tolakan, meringkuk di udara,
      // lalu melecut melengkung saat kontak; pinggang meliuk bergelombang sepanjang aksi.
      lean = tr([[0, 0.05], [0.25, 0.45], [0.5, -0.9], [0.8, -0.6], [0.95, 0.75], [1.15, 0.2], [1.45, -0.25], [1.8, 0.05]]);
      twist = tr([[0, 0], [0.5, 0.5], [0.95, -0.55], [1.4, 0.2], [1.8, 0]]);
      wig = 0.12;
    } else {
      hipR = tr([[0, -0.2], [0.3, 0.3], [0.55, 1.5], [0.85, 2.4], [1.1, 2.2], [1.4, 0.3], [1.8, -0.2]]);
      kneeR = tr([[0, -0.5], [0.3, -1.1], [0.55, -1.2], [0.85, -0.05], [1.1, -0.1], [1.4, -0.9], [1.8, -0.5]]);
      hipL = tr([[0, 0.2], [0.4, -0.2], [0.85, -0.5], [1.4, 0.1], [1.8, 0.2]]);
      kneeL = tr([[0, -0.4], [0.4, -0.9], [0.85, -0.3], [1.4, -0.8], [1.8, -0.4]]);
      shL = tr([[0, 0.9], [0.5, 1.9], [0.9, 2.4], [1.5, 1.0], [1.8, 0.9]]);
      shR = tr([[0, 0.5], [0.5, -1.3], [0.9, -1.7], [1.5, -0.5], [1.8, 0.5]]);
      lift = tr([[0, 0], [0.35, 0], [0.55, 0.55], [0.85, 0.8], [1.15, 0.4], [1.4, 0], [1.8, 0]]);
      lean = tr([[0, 0.05], [0.4, 0.1], [0.85, 0.55], [1.2, 0.3], [1.6, 0.06], [1.8, 0.05]]);
      twist = tr([[0, 0], [0.85, -0.5], [1.8, 0]]);
      squash = a > 1.2 && a < 1.6 ? Math.sin(((a - 1.2) / 0.4) * Math.PI) * 0.08 : 0;
      stretch = 1 + 0.3 * Math.max(0, 1 - Math.abs(a - 0.9) / 0.2);
      lean = tr([[0, 0.05], [0.4, -0.35], [0.85, 0.95], [1.2, 0.4], [1.6, -0.1], [1.8, 0.05]]);
      twist = tr([[0, 0], [0.4, 0.4], [0.85, -0.8], [1.3, 0.2], [1.8, 0]]);
      wig = 0.1;
    }
    if (!idle) {
      // Gelombang meliuk di badan (pinggang dan pundak bergantian) supaya tidak kaku.
      const env = Math.sin((Math.min(Math.max(a, 0), 1.8) / 1.8) * Math.PI);
      lean += Math.sin(a * 13) * wig * env;
      twist += Math.cos(a * 11) * wig * 0.8 * env;
      this.body.rotation.x = Math.sin(a * 9) * 0.1 * env;
    } else this.body.rotation.x = 0;
    this.model.rotation.y = yaw;
    this.flip.rotation.z = flip;
    this.body.position.y = -FLIP_Y + lift;
    this.body.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
    this.spine.rotation.z = lean;
    this.spine.rotation.y = twist;
    this.legR.rotation.z = hipR;
    this.kneeR.rotation.z = kneeR;
    this.legR.scale.y = stretch;
    if (this.footR) this.footR.scale.y = 1 / stretch;
    this.legL.rotation.z = hipL;
    this.kneeL.rotation.z = kneeL;
    this.armL.rotation.z = shL;
    this.armR.rotation.z = shR;
    this.elbowL.rotation.z = 0.45;
    this.elbowR.rotation.z = 0.45;
  }

  play(kind: AnimKind, frame: number, roll = false): void {
    this.animator.play(kind, frame, roll);
  }

  strike(kind: AnimKind, frame: number, p: Player, bx: number, by: number): void {
    this.animator.strike(kind, frame, p, bx, by);
  }

  dispose(): void {
    this.disposed = true;
    this.root.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh && o.name !== "outline") o.skeleton.dispose();
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.name !== "outline") (o.material as THREE.Material).dispose();
      }
    });
  }

  update(
    p: Player,
    frame: number,
    ball: { x: number; y: number },
    charging: boolean,
    mood: "win" | "lose" | null = null,
  ): void {
    const def = CHARS[this.charId];
    const a = this.animator.compute(p, frame, ball, charging, def.special);
    const o = a.pose;

    // Terhuyung (kewalahan, kepleset, kena sandal): badan miring ke belakang, tangan dan
    // kaki menggapai-gapai sampai pulih.
    if (p.stun > 0) {
      const t = performance.now() / 1000;
      const flail = Math.sin(t * 34);
      o.lean = 0.55 + flail * 0.08;
      o.shL = 2.4 + flail * 0.6;
      o.shR = -2.0 - flail * 0.6;
      o.elL = o.elR = 0.3;
      o.hipR = 1.0 + flail * 0.3;
      o.kneeR = -0.7;
      o.hipL = -0.3;
      o.kneeL = -0.5;
      a.look = 0.6;
      a.squash = -0.08;
    }

    // Selebrasi dan lesu memakai waktu nyata, supaya tetap bergerak saat permainan berhenti.
    // Tiap karakter punya satu dari tiga gaya selebrasi dan dua gaya lesu.
    if (mood === "win" && this.charId % 3 === 1) {
      // Berputar dengan tangan terentang.
      const t = performance.now() / 1000;
      a.spinY = t * 9;
      a.lift = 0.12 + Math.abs(Math.sin(t * 9)) * 0.12;
      a.squash = 0.06;
      a.look = 0.4;
      o.shL = 1.6;
      o.shR = 1.6;
      o.elL = o.elR = 0.1;
      o.hipL = 0.25;
      o.hipR = -0.25;
      o.kneeL = o.kneeR = -0.3;
    } else if (mood === "win" && this.charId % 3 === 2) {
      // Goyang sambil mengepal bergantian.
      const t = performance.now() / 1000;
      const beat = Math.sin(t * 10);
      a.lift = Math.abs(beat) * 0.1;
      a.squash = beat * 0.12;
      a.look = 0.35;
      o.lean = beat * 0.22;
      o.twist = beat * 0.5;
      o.shL = 2.2 + beat * 0.9;
      o.shR = 2.2 - beat * 0.9;
      o.elL = o.elR = 1.2;
      o.hipL = beat * 0.35;
      o.hipR = -beat * 0.35;
      o.kneeL = o.kneeR = -0.5 - Math.abs(beat) * 0.3;
    } else if (mood === "lose" && this.charId % 2 === 1) {
      // Geleng-geleng sambil memegang kepala.
      const t = performance.now() / 1000;
      a.look = -0.2;
      a.squash = -0.06;
      o.lean = -0.2;
      o.twist = Math.sin(t * 7) * 0.45;
      o.shL = o.shR = 2.6;
      o.elL = o.elR = 1.7;
      o.kneeL = o.kneeR = -0.35;
      o.hipL = o.hipR = 0.2;
    } else if (mood === "win") {
      const t = performance.now() / 1000;
      const hop = Math.abs(Math.sin(t * 7));
      a.lift = hop * 0.4;
      a.squash = (hop - 0.5) * 0.2;
      a.look = 0.5;
      o.shL = 2.9 + Math.sin(t * 14) * 0.25;
      o.shR = 2.9 - Math.sin(t * 14) * 0.25;
      o.elL = o.elR = 0.2;
      o.hipL = 0.5 * hop;
      o.hipR = -0.3 * hop;
      o.kneeL = -1.1 * hop;
      o.kneeR = -0.6 * hop;
      o.lean = 0.12;
    } else if (mood === "lose") {
      a.look = -0.45;
      a.squash = -0.1;
      o.lean = -0.45;
      o.shL = o.shR = 0.35;
      o.elL = o.elR = 0.05;
      o.kneeL = o.kneeR = -0.5;
      o.hipL = o.hipR = 0.3;
      o.bob = -0.05;
    }

    // Hiasan di kepala tertinggal di belakang gerakan.
    const vxLocal = p.vx * p.facing;
    for (let n = 0; n < a.df; n++) {
      const target = clamp(-vxLocal * 0.09 + p.vy * 0.04, -0.9, 0.9);
      this.wobbleVel = (this.wobbleVel + (target - this.wobbleAngle) * 0.14) * 0.86;
      this.wobbleAngle += this.wobbleVel;
    }
    for (const w of this.wobble) w.rotation.z = this.wobbleAngle + (w.userData.rest ?? 0);

    this.root.position.set(p.x + a.jitterX, p.y, 0);
    const yaw = lerp(0.55, 0.15, a.face);
    this.model.rotation.y = (p.facing > 0 ? -yaw : Math.PI + yaw) + a.spinY * p.facing;
    this.flip.rotation.z = a.flipZ;
    this.body.position.y = -FLIP_Y + o.bob + a.lift;
    // Badan empuk: melar dan gepengnya lebih kuat daripada karakter biasa.
    const sq = a.squash * 1.5;
    this.body.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);
    // Wajah ada di badan, jadi seluruh badan ikut mendongak mengikuti bola.
    this.spine.rotation.z = o.lean * 0.7 + a.look * 0.22 + a.nod * 0.5;
    this.spine.rotation.y = o.twist * 0.6;
    for (const pupil of this.pupils) pupil.position.y = this.pupilY + clamp(a.look, -0.5, 0.8) * 0.06;

    this.legL.rotation.z = o.hipL;
    this.legR.rotation.z = o.hipR;
    this.kneeL.rotation.z = o.kneeL;
    this.kneeR.rotation.z = o.kneeR;
    this.legR.scale.y = a.legStretch;
    // Sepatu tidak ikut melar (hanya betisnya).
    if (this.footR) this.footR.scale.y = 1 / Math.max(0.2, a.legStretch);
    this.armL.rotation.z = o.shL;
    this.armR.rotation.z = o.shR;
    this.elbowL.rotation.z = o.elL;
    this.elbowR.rotation.z = o.elR;

    this.skin.emissive.setHex(def.color);
    this.skin.emissiveIntensity = a.glow * 0.55;
    if (this.aiSkin) {
      this.aiSkin.emissive.setHex(def.color);
      this.aiSkin.emissiveIntensity = a.glow * 0.55;
    }
    if (this.limbSkin) {
      this.limbSkin.emissive.setHex(def.color);
      this.limbSkin.emissiveIntensity = a.glow * 0.55;
    }
  }
}
