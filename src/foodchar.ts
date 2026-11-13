import * as THREE from "three";
import { Animator, clamp, lerp, type AnimKind } from "./animator";
import { CHARS, type Player } from "./sim";
import { addOutline, toon } from "./style";

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
  | "cendol";

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
];

const HIP_Y = 0.42;
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

interface BodySpec {
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

  private model = new THREE.Group();
  private flip = new THREE.Group(); // titik putar salto, di tengah badan
  private body = new THREE.Group();
  private spine = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elbowL = new THREE.Group();
  private elbowR = new THREE.Group();
  private skin: THREE.MeshToonMaterial;
  private pupils: THREE.Mesh[] = [];
  private pupilY = 0;
  private wobble: THREE.Object3D[] = []; // hiasan di kepala yang ikut bergoyang
  private wobbleAngle = 0;
  private wobbleVel = 0;
  // Kaki karet boleh melar jauh, jadi jangkauannya lebih besar dari karakter biasa.
  private animator = new Animator(HIP_Y * MODEL_SCALE, LEG_LEN, 3.2);

  constructor(charId: number) {
    this.charId = charId;
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

    // Wajah: mata besar yang pupilnya mengikuti bola, alis, dan mulut.
    const ink = new THREE.MeshBasicMaterial({ color: 0x17131c });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const fs = spec.faceSize;
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
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035 * fs, 0.17 * fs), ink);
      brow.position.set(spec.faceX + 0.01, spec.faceY + 0.2 * fs, z);
      brow.rotation.x = z > 0 ? 0.4 : -0.4;
      this.spine.add(brow);
    }
    this.pupilY = spec.faceY;
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075 * fs, 0.016 * fs, 6, 12, Math.PI), ink);
    mouth.rotation.set(0, Math.PI / 2, Math.PI);
    mouth.position.set(spec.faceX + 0.012, spec.faceY - 0.17 * fs, 0);
    this.spine.add(mouth);
    for (const z of [-0.26 * fs, 0.26 * fs]) {
      const cheek = new THREE.Mesh(
        new THREE.CircleGeometry(0.05 * fs, 12),
        new THREE.MeshBasicMaterial({ color: 0xff7a7a, transparent: true, opacity: 0.55 }),
      );
      cheek.rotation.y = Math.PI / 2;
      cheek.position.set(spec.faceX + 0.005, spec.faceY - 0.11 * fs, z);
      this.spine.add(cheek);
    }

    // Kaki karet dengan sepatu besar warna tim.
    const buildLeg = (hip: THREE.Group, knee: THREE.Group, z: number) => {
      hip.position.set(0, HIP_Y, z);
      const thigh = part(new THREE.CapsuleGeometry(0.045, THIGH, 4, 8), limbMat, 0.012);
      thigh.position.y = -THIGH / 2;
      hip.add(thigh);
      knee.position.y = -THIGH;
      const shin = part(new THREE.CapsuleGeometry(0.042, SHIN, 4, 8), limbMat, 0.012);
      shin.position.y = -SHIN / 2;
      knee.add(shin);
      const shoe = part(new THREE.SphereGeometry(0.1, 12, 10), accent);
      shoe.scale.set(1.6, 0.75, 1);
      shoe.position.set(0.07, -SHIN - 0.03, 0);
      knee.add(shoe);
      hip.add(knee);
      this.body.add(hip);
    };
    buildLeg(this.legL, this.kneeL, -spec.legZ);
    buildLeg(this.legR, this.kneeR, spec.legZ);

    // Tangan karet dengan sarung tangan putih.
    const buildArm = (shoulder: THREE.Group, elbow: THREE.Group, z: number) => {
      shoulder.position.set(0, spec.armY, z);
      const upper = part(new THREE.CapsuleGeometry(0.04, UPPER_ARM, 4, 8), limbMat, 0.012);
      upper.position.y = -UPPER_ARM / 2;
      shoulder.add(upper);
      elbow.position.y = -UPPER_ARM;
      const fore = part(new THREE.CapsuleGeometry(0.038, FOREARM, 4, 8), limbMat, 0.012);
      fore.position.y = -FOREARM / 2;
      elbow.add(fore);
      const hand = part(new THREE.SphereGeometry(0.085, 10, 8), glove);
      hand.position.y = -FOREARM - 0.05;
      elbow.add(hand);
      shoulder.add(elbow);
      this.spine.add(shoulder);
    };
    buildArm(this.armL, this.elbowL, -spec.armZ);
    buildArm(this.armR, this.elbowR, spec.armZ);

    this.model.scale.setScalar(MODEL_SCALE);
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
        skin.color.setHex(0xd4583c);
        add(part(new THREE.CapsuleGeometry(0.31, 0.68, 6, 18), skin, 0.022), 0, 0.6);
        const grill = toon(0x6e2a1c);
        for (const y of [0.18, 0.5, 1.02]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.312, 0.022, 5, 22), grill);
          band.rotation.set(Math.PI / 2 + 0.35, 0, 0.2);
          add(band, 0, y);
        }
        const knot = add(part(new THREE.SphereGeometry(0.09, 10, 8), toon(0xb8452e)), 0, 1.3);
        this.wobble.push(knot);
        const band = part(new THREE.TorusGeometry(0.305, 0.045, 6, 22), accent, 0.012);
        band.rotation.x = Math.PI / 2;
        add(band, 0, 1.02);
        return { faceX: 0.3, faceY: 0.74, faceSize: 0.95, armY: 0.5, armZ: 0.33, legZ: 0.13 };
      }
      case "lontong": {
        // Lontong: silinder berbungkus daun pisang, nasi putih mengintip di atas.
        skin.color.setHex(0x5aa852);
        add(part(new THREE.CylinderGeometry(0.31, 0.33, 1.0, 20), skin, 0.022), 0, 0.5);
        add(part(new THREE.SphereGeometry(0.29, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xfbf7e6), 0.02), 0, 0.98);
        add(part(new THREE.SphereGeometry(0.32, 18, 10), skin, 0.02), 0, 0.06).scale.set(1, 0.4, 1);
        const leaf = toon(0x3d8040);
        for (const y of [0.2, 0.86]) {
          const tie = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.022, 5, 22), leaf);
          tie.rotation.x = Math.PI / 2;
          add(tie, 0, y);
        }
        // Lidi penusuk yang bergoyang di kepala.
        const stick = part(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 5), toon(0xd9b98a), 0.008);
        stick.geometry.translate(0, 0.16, 0);
        this.wobble.push(add(stick, -0.05, 1.18));
        return { faceX: 0.31, faceY: 0.56, faceSize: 0.95, armY: 0.48, armZ: 0.34, legZ: 0.14 };
      }
      case "bakso": {
        // Bakso: bola besar dengan daun seledri dan taburan bawang goreng.
        skin.color.setHex(0xa98470);
        add(part(new THREE.SphereGeometry(0.52, 24, 18), skin, 0.024), 0, 0.52);
        const fried = toon(0xd9a047);
        const spots: Array<[number, number, number]> = [[0.1, 0.99, 0.18], [-0.12, 1.0, -0.1], [0.22, 0.93, -0.16], [-0.02, 1.03, 0.02]];
        for (const [x, y, z] of spots) add(part(new THREE.SphereGeometry(0.045, 6, 5), fried, 0.008), x, y, z);
        const leaf = part(new THREE.ConeGeometry(0.1, 0.26, 5), toon(0x4fae5a), 0.01);
        leaf.geometry.translate(0, 0.13, 0);
        leaf.scale.z = 0.4;
        this.wobble.push(add(leaf, -0.04, 1.02));
        return { faceX: 0.5, faceY: 0.56, faceSize: 1.2, armY: 0.5, armZ: 0.52, legZ: 0.2 };
      }
      case "tahu": {
        // Tahu goreng: kotak membulat keemasan, bagian atas lebih pucat, berkacamata.
        skin.color.setHex(0xe9b95a);
        add(part(roundedBox(0.66, 0.9, 0.66, 0.12), skin, 0.022), 0, 0.5);
        add(part(roundedBox(0.6, 0.12, 0.6, 0.05), toon(0xfbeec2), 0), 0, 0.93);
        const ink = new THREE.MeshBasicMaterial({ color: 0x17131c });
        for (const z of [-0.14, 0.14]) {
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.016, 6, 20), ink);
          rim.rotation.y = Math.PI / 2;
          add(rim, 0.345, 0.6, z);
        }
        add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.06), ink), 0.345, 0.62);
        const scarf = part(new THREE.TorusGeometry(0.36, 0.05, 6, 4), accent, 0.01);
        scarf.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        add(scarf, 0, 0.2);
        return { faceX: 0.335, faceY: 0.6, faceSize: 0.95, armY: 0.42, armZ: 0.35, legZ: 0.16 };
      }
      case "pisang": {
        // Pisang: tabung kuning melengkung dengan tangkai dan ujung cokelat.
        skin.color.setHex(0xf6cf2f);
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(-0.12, 0.08, 0),
          new THREE.Vector3(0.34, 0.66, 0),
          new THREE.Vector3(-0.14, 1.26, 0),
        );
        add(part(new THREE.TubeGeometry(curve, 20, 0.25, 14, false), skin, 0.022), 0, 0);
        add(part(new THREE.SphereGeometry(0.25, 14, 10), skin, 0.022), -0.12, 0.08);
        add(part(new THREE.SphereGeometry(0.25, 14, 10), skin, 0.022), -0.14, 1.26);
        const tip = toon(0x6b4a22);
        add(part(new THREE.SphereGeometry(0.07, 8, 6), tip, 0.01), -0.3, -0.06);
        const stem = part(new THREE.CylinderGeometry(0.05, 0.07, 0.24, 6), tip, 0.01);
        stem.geometry.translate(0, 0.12, 0);
        stem.userData.rest = 0.7;
        this.wobble.push(add(stem, -0.26, 1.44));
        const band = part(new THREE.TorusGeometry(0.255, 0.04, 6, 20), accent, 0.01);
        band.rotation.set(Math.PI / 2, 0, 0.5);
        add(band, 0.06, 1.0);
        return { faceX: 0.36, faceY: 0.7, faceSize: 0.82, armY: 0.5, armZ: 0.27, legZ: 0.12 };
      }
      case "eslilin": {
        // Es lilin: balok es membulat dengan stik kayu dan tetesan yang meleleh.
        skin.color.setHex(0x86dcf0);
        add(part(roundedBox(0.5, 1.12, 0.58, 0.2), skin, 0.022), 0, 0.6);
        add(part(roundedBox(0.44, 0.3, 0.52, 0.15), toon(0xd9f6ff), 0), 0, 1.02);
        const stick = part(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), toon(0xd9b98a), 0.012);
        stick.scale.z = 0.5;
        add(stick, 0, -0.08);
        const drip = part(new THREE.SphereGeometry(0.06, 8, 8), skin, 0.01);
        drip.scale.y = 1.5;
        this.wobble.push(add(drip, 0.1, 0.03, 0.22));
        const band = part(new THREE.TorusGeometry(0.33, 0.04, 6, 4), accent, 0.01);
        band.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        band.scale.set(0.82, 0.95, 1);
        add(band, 0, 0.2);
        return { faceX: 0.255, faceY: 0.68, faceSize: 0.85, armY: 0.5, armZ: 0.31, legZ: 0.13 };
      }
      case "jagung": {
        // Jagung bakar: tongkol kuning meruncing, kelobot hijau di bawah, rambut jagung di atas.
        skin.color.setHex(0xf7d03a);
        const profile: Array<[number, number]> = [
          [0.001, 0.0], [0.24, 0.03], [0.3, 0.2], [0.3, 0.7], [0.24, 1.1], [0.13, 1.34], [0.001, 1.42],
        ];
        add(part(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18), skin, 0.022), 0, 0);
        const row = toon(0xe0a81f);
        for (const y of [0.3, 0.52, 0.74, 0.96]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(y > 0.8 ? 0.275 : 0.302, 0.014, 4, 22), row);
          ring.rotation.x = Math.PI / 2;
          add(ring, 0, y);
        }
        const husk = toon(0x5aa852);
        for (let k = 0; k < 5; k++) {
          const leaf = part(new THREE.ConeGeometry(0.2, 0.6, 5), husk, 0.012);
          leaf.scale.z = 0.35;
          const pivot = new THREE.Group();
          pivot.rotation.y = (k / 5) * Math.PI * 2 + 0.6;
          leaf.position.set(0.3, 0.26, 0);
          leaf.rotation.z = -0.35;
          pivot.add(leaf);
          add(pivot, 0, 0);
        }
        const silk = part(new THREE.ConeGeometry(0.09, 0.3, 6), accent, 0.01);
        silk.geometry.translate(0, 0.15, 0);
        this.wobble.push(add(silk, 0, 1.38));
        return { faceX: 0.3, faceY: 0.78, faceSize: 0.88, armY: 0.52, armZ: 0.32, legZ: 0.13 };
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
  pose(): void {
    this.model.rotation.y = -0.7;
    this.armL.rotation.z = 0.5;
    this.armR.rotation.z = 2.7;
    this.elbowR.rotation.z = 0.5;
    this.legL.rotation.z = -0.12;
    this.legR.rotation.z = 0.12;
  }

  play(kind: AnimKind, frame: number, roll = false): void {
    this.animator.play(kind, frame, roll);
  }

  strike(kind: AnimKind, frame: number, p: Player, bx: number, by: number): void {
    this.animator.strike(kind, frame, p, bx, by);
  }

  dispose(): void {
    this.root.traverse((o) => {
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
    this.armL.rotation.z = o.shL;
    this.armR.rotation.z = o.shR;
    this.elbowL.rotation.z = o.elL;
    this.elbowR.rotation.z = o.elR;

    this.skin.emissive.setHex(def.color);
    this.skin.emissiveIntensity = a.glow * 0.55;
  }
}
