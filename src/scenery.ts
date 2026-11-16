import * as THREE from "three";
import { COURT_HALF, NET_H, NET_R, CHARS } from "./sim";
import { crowdGeometry, crowdMaterial } from "./crowd";
import { addOutline, toon } from "./style";

// Arena: lapangan takraw dengan empat latar (kampung, pantai, pasar malam, sekolah) dan
// tiga waktu (siang, sore, malam). Semua dari bentuk dasar + shader gambar tangan.

export type ArenaId = "kampung" | "pantai" | "pasarmalam" | "sekolah";
export type TimeId = "siang" | "sore" | "malam";

export const ARENAS: ReadonlyArray<{ id: ArenaId; name: string }> = [
  { id: "kampung", name: "Kampung 17-an" },
  { id: "pantai", name: "Pantai" },
  { id: "pasarmalam", name: "Pasar Malam" },
  { id: "sekolah", name: "Lapangan Sekolah" },
];
export const TIMES: ReadonlyArray<{ id: TimeId; name: string }> = [
  { id: "siang", name: "Siang" },
  { id: "sore", name: "Sore" },
  { id: "malam", name: "Malam" },
];

const DEPTH = 7;

interface Look {
  sky: [string, string, string, string]; // gradasi langit dari atas ke bawah
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  sunColor: number;
  sunInt: number;
  sunPos: [number, number, number];
  disc: number; // warna matahari atau bulan
  discPos: [number, number];
  discR: number;
  cloud: number;
  stars: boolean;
  glow: number; // 0..1: seberapa terang jendela dan lampu menyala
  dim: number; // pengali warna latar jauh (bukit, laut) supaya ikut menggelap
}

const LOOKS: Record<TimeId, Look> = {
  siang: {
    sky: ["#2f8fd0", "#7fcbe6", "#fbe7b4", "#f6b77a"],
    hemiSky: 0xfff6e0,
    hemiGround: 0x8a7fa8,
    hemiInt: 1.5,
    sunColor: 0xfff1d6,
    sunInt: 2.6,
    sunPos: [-7, 15, 9],
    disc: 0xfff3c4,
    discPos: [-16, 15],
    discR: 4,
    cloud: 0xfffdf4,
    stars: false,
    glow: 0,
    dim: 1,
  },
  sore: {
    sky: ["#3b4a9a", "#c7689a", "#ff9d5c", "#ffd27a"],
    hemiSky: 0xffd9b0,
    hemiGround: 0x7a5a8a,
    hemiInt: 1.35,
    sunColor: 0xffb070,
    sunInt: 2.3,
    sunPos: [-13, 8, 8],
    disc: 0xffd27a,
    discPos: [-20, 6.5],
    discR: 5.5,
    cloud: 0xffc9a8,
    stars: false,
    glow: 0.55,
    dim: 0.82,
  },
  malam: {
    sky: ["#0c1030", "#1d2456", "#3a3470", "#6a4a7a"],
    hemiSky: 0xaab6ff,
    hemiGround: 0x5a5a8c,
    hemiInt: 1.5,
    sunColor: 0xc8d4ff,
    sunInt: 1.5,
    sunPos: [6, 15, 9],
    disc: 0xf4f1dc,
    discPos: [15, 17],
    discR: 2.6,
    cloud: 0x4a4f86,
    stars: true,
    glow: 1,
    dim: 0.5,
  },
};

function skyTexture(stops: readonly string[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  const at = [0, 0.45, 0.72, 1];
  stops.forEach((s, i) => grad.addColorStop(at[i], s));
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const shade = (color: number, k: number) => new THREE.Color(color).multiplyScalar(k).getHex();

// Bahan yang menyala sendiri (jendela, lampu): tidak terpengaruh cahaya.
function lit(color: number, glow: number, off = 0x5a4a3a): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(off).lerp(new THREE.Color(color), Math.min(1, glow * 1.4)) });
}

function house(w: number, h: number, d: number, wall: number, roof: number, glow: number): THREE.Group {
  const g = new THREE.Group();
  const body = addOutline(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(wall)), 0.06);
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  const top = addOutline(new THREE.Mesh(new THREE.ConeGeometry(1, h * 0.55, 4), toon(roof)), 0.06);
  top.rotation.y = Math.PI / 4;
  top.scale.set(w * 0.82, 1, d * 0.82);
  top.position.y = h + h * 0.27;
  g.add(top);
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.55, 0.05), toon(0x5a3a28));
  door.position.set(-w * 0.2, h * 0.275, d / 2 + 0.02);
  g.add(door);
  const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.26, h * 0.26, 0.05), glow > 0 ? lit(0xffe08a, glow, 0xffe9a0) : toon(0xffe9a0));
  win.position.set(w * 0.2, h * 0.58, d / 2 + 0.02);
  g.add(win);
  return g;
}

function palm(height: number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = toon(0x9a6b43);
  const leafMat = toon(0x3f9a4c);
  const segs = 5;
  let x = 0;
  for (let i = 0; i < segs; i++) {
    const seg = addOutline(
      new THREE.Mesh(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, height / segs + 0.05, 7), trunkMat),
      0.05,
    );
    x += i * 0.07;
    seg.position.set(x, (i + 0.5) * (height / segs), 0);
    seg.rotation.z = -i * 0.06;
    g.add(seg);
  }
  for (let k = 0; k < 7; k++) {
    const leaf = addOutline(new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.8, 5), leafMat), 0.05);
    const a = (k / 7) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(x + 0.1, height, 0);
    pivot.rotation.y = a;
    leaf.scale.z = 0.35;
    leaf.rotation.z = -1.95;
    leaf.position.set(1.2, -0.45, 0);
    pivot.add(leaf);
    g.add(pivot);
  }
  // Kelapa.
  for (const [dx, dz] of [[0.2, 0.15], [-0.05, -0.18], [0.28, -0.1]] as const) {
    const nut = addOutline(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), toon(0x6b4a22)), 0.03);
    nut.position.set(x + dx, height - 0.35, dz);
    g.add(nut);
  }
  return g;
}

// Pohon rindang: batang dan tajuk bulat bertumpuk.
function tree(height: number, leaf: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, height, 7), toon(0x8a5a3a)), 0.05);
  trunk.position.y = height / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const blobs: Array<[number, number, number, number]> = [
    [0, height + 0.9, 0, 1.7], [-1.1, height + 0.3, 0.2, 1.2], [1.1, height + 0.4, -0.2, 1.25], [0.1, height + 1.9, 0, 1.1],
  ];
  for (const [x, y, z, r] of blobs) {
    const b = addOutline(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), toon(leaf)), 0.06);
    b.position.set(x, y, z);
    g.add(b);
  }
  return g;
}

function cloud(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const blobs: Array<[number, number, number]> = [
    [0, 0, 1.6], [1.7, 0.3, 1.9], [3.5, 0, 1.5], [1.2, -0.5, 1.5], [2.6, -0.5, 1.4],
  ];
  for (const [x, y, r] of blobs) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 18), mat);
    m.position.set(x, y, 0);
    g.add(m);
  }
  return g;
}

// Tenda bergaris: kerucut dengan warna selang-seling per sisi.
function stripedCone(radius: number, height: number, a: number, b: number, sides = 10): THREE.Mesh {
  const geo = new THREE.ConeGeometry(radius, height, sides, 1, true).toNonIndexed();
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let i = 0; i < count; i++) {
    const c = Math.floor(i / 6) % 2 === 0 ? ca : cb;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
}

interface Fan {
  body: THREE.Object3D;
  baseY: number;
  phase: number;
}

export class Scenery {
  arena: ArenaId = "kampung";
  time: TimeId = "siang";
  private root = new THREE.Group();
  private clouds: THREE.Group[] = [];
  private flags: THREE.Mesh[] = [];
  private fans: Fan[] = [];
  private spinners: Array<{ o: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }> = [];
  private bobbers: Array<{ o: THREE.Object3D; baseY: number; amp: number; speed: number; phase: number }> = [];
  private upright: THREE.Object3D[] = []; // kabin bianglala: selalu tegak walau rodanya berputar
  private waves: THREE.Mesh[] = [];
  private blinkers: Array<{ m: THREE.MeshBasicMaterial; on: number; off: number; phase: number }> = [];
  private cheerUntil = 0;
  private fanMeshes: THREE.Mesh[] = [];
  private crowdChars: readonly number[] = [];
  private buildId = 0; // naik tiap arena dibangun ulang; muatan model yang terlambat diabaikan
  private target: THREE.Object3D = this.root; // tempat add() menaruh benda

  constructor(
    private scene: THREE.Scene,
    private hemi: THREE.HemisphereLight,
    private sun: THREE.DirectionalLight,
  ) {
    scene.add(this.root);
    this.set("kampung", "siang");
  }

  // Ganti arena atau waktu: latar lama dibuang, yang baru dibangun.
  set(arena: ArenaId, time: TimeId): void {
    this.arena = arena;
    this.time = time;
    this.buildId++;
    this.target = this.root;
    this.root.traverse((o) => {
      if (o.userData.shared) return; // model yang dipakai bersama tetap disimpan
      if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (o.name !== "outline") for (const m of mats) m.dispose();
      }
    });
    this.root.clear();
    this.clouds = [];
    this.flags = [];
    this.fans = [];
    this.spinners = [];
    this.bobbers = [];
    this.upright = [];
    this.waves = [];
    this.blinkers = [];

    const look = LOOKS[time];
    const old = this.scene.background;
    this.scene.background = skyTexture(look.sky);
    if (old instanceof THREE.Texture) old.dispose();
    this.hemi.color.setHex(look.hemiSky);
    this.hemi.groundColor.setHex(look.hemiGround);
    this.hemi.intensity = look.hemiInt;
    this.sun.color.setHex(look.sunColor);
    this.sun.intensity = look.sunInt;
    this.sun.position.set(...look.sunPos);

    this.buildSky(look, arena);
    this.buildCourt(look, arena);
    this.buildCrowd();
    if (arena === "kampung") this.buildKampung(look);
    else if (arena === "pantai") this.buildPantai(look);
    else if (arena === "pasarmalam") this.buildPasarMalam(look);
    else this.buildSekolah(look);
    if (arena !== "pantai") void this.loadProps(arena, this.buildId);
  }

  // Properti tambahan dari 3DGarden (koleksi Street furniture dan Candy shop) di depan latar buatan
  // kode. Dimuat setelah arenanya tampil; kalau gagal dimuat, arena tetap utuh tanpa properti itu.
  // Bentuk: [model, x, z, skala, putar-y, berdiri-tegak (model rebah di sumbu z), tinggi tumpukan]
  private async loadProps(arena: ArenaId, id: number): Promise<void> {
    type Prop = [string, number, number, number, number, boolean?, number?];
    const lists: Record<string, Prop[]> = {
      kampung: [
        ["vintage-street-light", -10.2, -8.3, 1.3, 0],
        ["vintage-street-light", 8.6, -8.5, 1.3, 0],
        ["electric-pole-01", -3.4, -9.4, 0.62, 0.2],
        ["mail-box", -7.8, -8.0, 1.2, 0.5],
        ["cast-iron-wooden-park-bench", -5.3, -8.0, 1.7, 0],
        ["cast-iron-wooden-park-bench", 4.9, -8.1, 1.7, 0],
        ["trash-can", 10.6, -8.0, 1.7, 0],
        ["fire-hydrant", 6.8, -8.2, 1.7, 0],
        ["city-bush-01", -13.3, -8.2, 2.2, 0.4],
        ["city-bush-01", 14.8, -8.4, 2.2, 2.0],
      ],
      sekolah: [
        ["bus-stop-01", 10.6, -9.6, 1.7, 0],
        ["bike-rack-barricade", -8.2, -8.4, 1.6, 0],
        ["bike-rack-barricade", -5.6, -8.5, 1.6, 0.1],
        ["sharp-fence-2", -16.8, -8.8, 1.8, 0],
        ["sharp-fence-2", 17.2, -8.8, 1.8, Math.PI / 2],
        ["vintage-street-light", -3.6, -8.6, 1.3, 0],
        ["vintage-street-light", 4.4, -8.6, 1.3, 0],
        ["cast-iron-wooden-park-bench", 0.6, -8.2, 1.7, 0],
        ["city-bush-01", -10.8, -8.4, 2.2, 0.8],
        ["city-bush-01", 15.6, -8.4, 2.2, 1.9],
      ],
      pasarmalam: [
        // Tumpukan donat raksasa dan lolipop spiral berdiri sebagai dekor pasar malam.
        ["donut", -13.8, -9.6, 9, 0.3],
        ["donut", -13.7, -9.5, 9, 1.2, false, 1.13],
        ["donut", 14.6, -9.8, 9, 0.9],
        ["sucette-spirale", -5.2, -9.4, 6, 0.2, true],
        ["sucette-spirale", 5.4, -9.4, 6, -0.3, true],
        ["sucette-spirale", 10.8, -9.8, 5.2, 0.5, true],
      ],
    };
    const list = lists[arena] ?? [];
    try {
      const { getModel, stand } = await import("./models");
      const group = new THREE.Group();
      await Promise.all(
        list.map(async ([slug, x, z, scale, rot, upright, lift]) => {
          const m = await getModel(slug);
          let obj: THREE.Object3D = m;
          if (upright) {
            // Lolipop dari katalog rebah di lantai: tegakkan.
            obj = new THREE.Group();
            m.rotation.x = -Math.PI / 2;
            obj.add(m);
          }
          stand(obj, x, -0.3 + (lift ?? 0), z, scale, rot);
          group.add(obj);
        }),
      );
      if (id !== this.buildId) return; // arena sudah diganti selagi memuat
      this.root.add(group);
    } catch {
      // gagal dimuat: arena tetap tampil tanpa properti tambahan
    }
  }

  private add<T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0): T {
    o.position.set(x, y, z);
    this.target.add(o);
    return o;
  }

  private buildSky(look: Look, arena: ArenaId): void {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(look.discR, 32), new THREE.MeshBasicMaterial({ color: look.disc }));
    this.add(disc, look.discPos[0], look.discPos[1], -58);
    if (look.stars) {
      // Bulan sabit: lingkaran berwarna langit menutupi sebagian bulan.
      const bite = new THREE.Mesh(new THREE.CircleGeometry(look.discR * 0.9, 32), new THREE.MeshBasicMaterial({ color: 0x1d2456 }));
      this.add(bite, look.discPos[0] + look.discR * 0.45, look.discPos[1] + look.discR * 0.2, -57.9);
      const pts: number[] = [];
      for (let i = 0; i < 160; i++) {
        const h = Math.imul(i + 11, 2654435761) >>> 0;
        pts.push(((h % 1000) / 1000 - 0.5) * 120, 8 + (((h >>> 10) % 1000) / 1000) * 34, -59);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfffbe0, size: 0.28, sizeAttenuation: true })));
    }
    const spots: Array<[number, number, number]> = [[-22, 16, 1.5], [-2, 19, 1.9], [17, 15, 1.4], [30, 20, 1.7]];
    for (const [x, y, sc] of arena === "pasarmalam" ? spots.slice(0, 2) : spots) {
      const c = cloud(look.cloud);
      c.scale.setScalar(sc);
      this.add(c, x, y, -55);
      this.clouds.push(c);
    }
  }

  // Lapangan, net, tiang, dan umbul-umbul: sama di semua arena, warnanya saja yang beda.
  private buildCourt(look: Look, arena: ArenaId): void {
    const ground = { kampung: 0x7dbb5a, pantai: 0xf0d79a, pasarmalam: 0x8a7a66, sekolah: 0x8fbf66 }[arena];
    const slabColor = { kampung: 0xcdb98c, pantai: 0xd9b877, pasarmalam: 0x6f6a78, sekolah: 0x9aa0a8 }[arena];
    const tints = {
      kampung: [0xe6cfa0, 0xdcd0a6],
      pantai: [0xf6e2ae, 0xf0d9a0],
      pasarmalam: [0x9a8fb0, 0x8f86a6],
      sekolah: [0x7fb7a2, 0x76ad9a],
    }[arena];

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 140), toon(ground));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.add(grass, 0, -0.3, 0);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(COURT_HALF * 2 + 1.2, 0.3, DEPTH + 1.2), toon(slabColor));
    slab.receiveShadow = true;
    this.add(slab, 0, -0.16, 0);
    for (let i = 0; i < 2; i++) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(COURT_HALF, 0.02, DEPTH), toon(tints[i]));
      half.receiveShadow = true;
      this.add(half, (i === 0 ? -1 : 1) * (COURT_HALF / 2), -0.005, 0);
    }

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
    const addLine = (x: number, z: number, w: number, d: number) => {
      this.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), lineMat), x, 0.012, z);
    };
    addLine(0, DEPTH / 2 - 0.06, COURT_HALF * 2, 0.12);
    addLine(0, -DEPTH / 2 + 0.06, COURT_HALF * 2, 0.12);
    addLine(-COURT_HALF + 0.06, 0, 0.12, DEPTH);
    addLine(COURT_HALF - 0.06, 0, 0.12, DEPTH);
    addLine(0, 0, 0.12, DEPTH);
    // Lingkaran servis di tiap sisi, seperti lapangan takraw sungguhan.
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 28), lineMat);
      ring.rotation.x = -Math.PI / 2;
      this.add(ring, sx * 4, 0.012, 0);
    }

    const net = new THREE.Mesh(
      new THREE.BoxGeometry(NET_R * 2, NET_H - 0.7, DEPTH - 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2a2733, transparent: true, opacity: 0.35 }),
    );
    this.add(net, 0, 0.7 + (NET_H - 0.7) / 2, 0);
    const tape = addOutline(new THREE.Mesh(new THREE.BoxGeometry(NET_R * 2 + 0.06, 0.16, DEPTH - 0.4), toon(0xfffaf0)), 0.03);
    tape.castShadow = true;
    this.add(tape, 0, NET_H - 0.08, 0);
    const bamboo = toon(arena === "sekolah" ? 0xd8dde4 : 0xc9a85a);
    for (const z of [-1, 1]) {
      const post = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, NET_H + 0.3, 8), bamboo), 0.03);
      post.castShadow = true;
      this.add(post, 0, (NET_H + 0.3) / 2, z * (DEPTH / 2 - 0.2));
    }

    // Tiang di tepi lapangan: batas pantul bola, sekaligus tiang umbul-umbul.
    const POLE_H = 8.4;
    for (const sx of [-1, 1]) {
      for (const z of [-DEPTH / 2, DEPTH / 2]) {
        const pole = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, POLE_H, 8), bamboo), 0.035);
        pole.castShadow = true;
        this.add(pole, sx * (COURT_HALF + 0.15), POLE_H / 2 - 0.2, z);
      }
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(DEPTH, 13),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      wall.rotation.y = Math.PI / 2;
      this.add(wall, sx * COURT_HALF, 6.5, 0);
    }

    // Hiasan melintang di belakang lapangan: umbul-umbul, atau lampu warna-warni di pasar malam.
    const span = COURT_HALF + 0.15;
    const ropePts: THREE.Vector3[] = [];
    const COUNT = 26;
    const flagGeo = new THREE.ShapeGeometry(
      new THREE.Shape([new THREE.Vector2(-0.24, 0), new THREE.Vector2(0.24, 0), new THREE.Vector2(0, -0.62)]),
    );
    const palette =
      arena === "pantai"
        ? [0xff5a3c, 0xffd23f, 0x2fb4d6, 0xfffaf0, 0x7dbb5a]
        : arena === "sekolah"
          ? [0xe5392d, 0xfffaf0, 0x4a7de0, 0xffd23f]
          : [0xe5392d, 0xfffaf0];
    const bulbColors = [0xff5a3c, 0xffd23f, 0x4dffd2, 0xff8ad8, 0x7dff6a];
    for (let i = 0; i <= COUNT; i++) {
      const u = i / COUNT;
      const x = lerpN(-span, span, u);
      const y = POLE_H - 0.5 - Math.sin(u * Math.PI) * 1.3;
      ropePts.push(new THREE.Vector3(x, y, -DEPTH / 2));
      if (i === 0 || i === COUNT) continue;
      if (arena === "pasarmalam") {
        const mat = new THREE.MeshBasicMaterial({ color: bulbColors[i % bulbColors.length] });
        this.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat), x, y - 0.16, -DEPTH / 2);
        this.blinkers.push({ m: mat, on: bulbColors[i % bulbColors.length], off: shade(bulbColors[i % bulbColors.length], 0.45), phase: i });
      } else {
        const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: palette[i % palette.length], side: THREE.DoubleSide }));
        this.add(flag, x, y, -DEPTH / 2);
        this.flags.push(flag);
      }
    }
    this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ropePts), new THREE.LineBasicMaterial({ color: 0x17131c })));

    // Lampu sorot di tiang saat malam, supaya lapangan terasa diterangi.
    if (look.glow > 0.5) {
      for (const sx of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
        lamp.rotation.z = sx * 0.5;
        this.add(lamp, sx * (COURT_HALF + 0.1), POLE_H - 0.1, DEPTH / 2);
        const beam = new THREE.Mesh(
          new THREE.ConeGeometry(3.4, 8.2, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
        );
        beam.rotation.z = sx * 0.42;
        this.add(beam, sx * (COURT_HALF - 1.6), POLE_H / 2 - 0.2, DEPTH / 2 - 0.2);
      }
    }
  }

  // Penonton: tiga baris jajanan kecil di tribun kayu bertingkat di belakang lapangan.
  // Bentuknya dari 12 jajanan (tanpa yang sedang bertanding); lihat setCrowdLineup.
  private buildCrowd(): void {
    const wood = toon(0xa9744a);
    const woodDark = toon(0x8a5a38);
    const width = COURT_HALF * 2 + 1;
    // Dua undakan kayu: bangku rendah untuk baris kedua dan panggung lebih tinggi untuk baris ketiga.
    const bench = addOutline(new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, 0.95), wood), 0.04);
    this.add(bench, 0, -0.05, -5.75);
    const stage = addOutline(new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 1.0, 1.0), woodDark), 0.04);
    this.add(stage, 0, 0.05, -6.75);
    // Pagar kayu kecil di depan panggung dan tiang penyangga.
    const rail = addOutline(new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.08, 0.08), wood), 0.025);
    this.add(rail, 0, 0.95, -6.25);
    for (let k = 0; k <= 8; k++) {
      const post = addOutline(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), wood), 0.02);
      this.add(post, -width / 2 - 0.1 + k * ((width + 0.2) / 8), 0.72, -6.25);
    }
    const ink = new THREE.MeshBasicMaterial({ color: 0x17131c });
    this.fanMeshes = [];
    let n = 0;
    const rows: Array<{ z: number; base: number; count: number; shift: number }> = [
      { z: -4.7, base: 0, count: 15, shift: 0 },
      { z: -5.7, base: 0.2, count: 14, shift: 0.5 },
      { z: -6.75, base: 0.55, count: 15, shift: 0.25 },
    ];
    rows.forEach((r, row) => {
      for (let k = 0; k < r.count; k++) {
        const x = -7.6 + k * 1.085 + r.shift;
        const fan = new THREE.Group();
        const body = addOutline(new THREE.Mesh(crowdGeometry(n % CHARS.length), crowdMaterial()), 0.025);
        body.userData.shared = true; // geometri dan bahan dipakai bersama; jangan dibuang saat arena berganti
        body.children[0].userData.shared = true;
        body.rotation.y = 0.12 * Math.sin(n * 2.3); // sedikit menoleh ke sana-sini
        fan.add(body);
        this.fanMeshes.push(body);
        // Sebagian penonton membawa bendera kecil.
        if ((k + row * 2) % 4 === 0) {
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), ink);
          stick.position.set(0.3, 0.75, 0);
          fan.add(stick);
          const mini = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), new THREE.MeshBasicMaterial({ color: 0xe5392d, side: THREE.DoubleSide }));
          mini.position.set(0.44, 0.92, 0);
          fan.add(mini);
        }
        this.add(fan, x, r.base, r.z);
        this.fans.push({ body: fan, baseY: r.base, phase: k * 1.7 + row * 0.9 });
        n++;
      }
    });
    this.assignCrowd();
    void this.loadCameo(this.buildId);
  }

  // Easter egg: satu penonton berjas berdiri di ujung kanan tribun atas, ikut melompat saat sorakan.
  private async loadCameo(id: number): Promise<void> {
    try {
      const { getModel, stand } = await import("./models");
      const m = await getModel("pojok");
      if (id !== this.buildId) return; // arena sudah diganti selagi memuat
      const holder = new THREE.Group();
      holder.add(m);
      stand(holder, 7.6, 0.55, -6.75, 0.82, -0.25);
      this.root.add(holder);
      this.fans.push({ body: holder, baseY: holder.position.y, phase: 2.2 });
    } catch {
      // gagal dimuat: tribun tetap tampil tanpa easter egg
    }
  }

  // Jajanan yang sedang bertanding tidak ikut duduk di tribun.
  setCrowdLineup(chars: readonly number[]): void {
    this.crowdChars = chars;
    this.assignCrowd();
  }

  private assignCrowd(): void {
    const allowed = CHARS.map((_, k) => k).filter((k) => !this.crowdChars.includes(k));
    const pool = allowed.length > 0 ? allowed : CHARS.map((_, k) => k);
    this.fanMeshes.forEach((m, i) => {
      const geo = crowdGeometry(pool[((Math.imul(i + 7, 2654435761) >>> 0) >>> 8) % pool.length]);
      m.geometry = geo;
      (m.children[0] as THREE.Mesh).geometry = geo;
    });
  }

  private hills(look: Look, list: Array<[number, number, number, number]>): void {
    for (const [x, z, r, color] of list) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), toon(shade(color, look.dim)));
      hill.scale.y = 0.42;
      this.add(hill, x, -2, z);
    }
  }

  private buildKampung(look: Look): void {
    this.hills(look, [[-20, -34, 20, 0x6aa85a], [12, -40, 26, 0x5d9c58], [36, -32, 18, 0x74b262]]);
    const row: Array<[number, number, number, number, number, number]> = [
      [-19, 5.5, 4.2, 0xf2d7a8, 0xc5563a, -13],
      [-12.5, 4.6, 3.6, 0x9fd6cf, 0xa8452f, -12],
      [-6, 5.8, 4.6, 0xf6b9a0, 0x7d4a36, -13.5],
      [1.5, 4.4, 3.4, 0xf7e7b6, 0xc5563a, -12],
      [8, 5.4, 4.4, 0xb7c9ef, 0x8a4630, -13],
      [14.5, 4.8, 3.8, 0xf2d7a8, 0xa8452f, -12.5],
      [21, 5.6, 4.4, 0xc9e5a8, 0x7d4a36, -13.5],
    ];
    for (const [x, w, h, wall, roof, z] of row) this.add(house(w, h, 4, wall, roof, look.glow), x, -0.3, z);
    // Tenda warung bergaris di depan salah satu rumah.
    const awning = addOutline(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.6), toon(0xe5392d)), 0.05);
    awning.rotation.x = 0.25;
    this.add(awning, 1.5, 2.3, -9.4);
    // Gapura 17-an di sisi kiri.
    const gate = new THREE.Group();
    for (const sx of [-1, 1]) {
      const pillar = addOutline(new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.6, 0.7), toon(0xe5392d)), 0.05);
      pillar.position.set(sx * 2.1, 2.3, 0);
      gate.add(pillar);
      const cap = addOutline(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.4, 0.95), toon(0xfffaf0)), 0.04);
      cap.position.set(sx * 2.1, 4.75, 0);
      gate.add(cap);
    }
    const beam = addOutline(new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.8, 0.5), toon(0xfffaf0)), 0.05);
    beam.position.y = 4.2;
    gate.add(beam);
    gate.rotation.y = 0.5;
    this.add(gate, -14.5, -0.3, -7.5);
    const palms: Array<[number, number, number]> = [[-15.5, -9, 7.5], [-9.5, -10.5, 6.2], [11.5, -9.5, 7], [18, -10, 8]];
    for (const [x, z, h] of palms) this.add(palm(h), x, -0.3, z);
    // Gerobak bakso di kanan.
    const cart = new THREE.Group();
    const box = addOutline(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.1), toon(0x4a7de0)), 0.05);
    box.position.y = 1.2;
    cart.add(box);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.0), new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.45 }));
    glass.position.y = 2.25;
    cart.add(glass);
    const roof = addOutline(new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.14, 1.4), toon(0xffd23f)), 0.04);
    roof.position.y = 2.8;
    cart.add(roof);
    for (const sx of [-0.7, 0.7]) {
      const wheel = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14), toon(0x2a2733)), 0.03);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(sx, 0.42, 0.6);
      cart.add(wheel);
    }
    if (look.glow > 0) {
      const lampu = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
      lampu.position.set(0, 2.55, 0.3);
      cart.add(lampu);
    }
    cart.rotation.y = -0.35;
    this.add(cart, 12.5, -0.3, -7.6);
  }

  private buildPantai(look: Look): void {
    // Laut sampai cakrawala, dengan garis ombak yang bergerak.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(240, 60), new THREE.MeshBasicMaterial({ color: shade(0x2fa7c9, look.dim + 0.1) }));
    sea.rotation.x = -Math.PI / 2;
    this.add(sea, 0, -0.26, -46);
    const foam = new THREE.MeshBasicMaterial({ color: shade(0xeafcff, Math.min(1, look.dim + 0.25)), transparent: true, opacity: 0.8 });
    for (let k = 0; k < 6; k++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(240, 0.35 + k * 0.12), foam);
      strip.rotation.x = -Math.PI / 2;
      this.add(strip, 0, -0.24, -17 - k * 5.5);
      this.waves.push(strip);
    }
    // Pulau di kejauhan.
    this.hills(look, [[-34, -62, 16, 0x4f9a62], [26, -66, 22, 0x4a905c], [58, -60, 12, 0x5aa66a]]);
    // Properti pantai buatan kode di bawah ini adalah cadangan: begitu model 3D-nya selesai
    // dimuat, kelompok ini diganti. Kalau gagal dimuat, cadangan inilah yang tetap tampil.
    const fallback = new THREE.Group();
    this.root.add(fallback);
    this.target = fallback;
    void this.loadPantai(fallback, this.buildId);
    // Perahu jukung bercadik yang terombang-ambing.
    for (const [x, z, sail] of [[-17, -24, 0xfffaf0], [14, -30, 0xff5a3c]] as const) {
      const boat = new THREE.Group();
      const hull = addOutline(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0x2f6fb0)), 0.05);
      hull.scale.set(2.6, 0.75, 0.6);
      boat.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 5), toon(0x6b4a22));
      mast.position.y = 1.7;
      boat.add(mast);
      const sailMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.4), new THREE.Vector2(0, 3.3), new THREE.Vector2(1.9, 0.6)])),
        new THREE.MeshBasicMaterial({ color: shade(sail, Math.min(1, look.dim + 0.3)), side: THREE.DoubleSide }),
      );
      boat.add(sailMesh);
      for (const sz of [-1, 1]) {
        const out = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 5), toon(0xd9b98a));
        out.rotation.z = Math.PI / 2;
        out.position.set(0, -0.1, sz * 1.3);
        boat.add(out);
      }
      this.add(boat, x, 0.1, z);
      this.bobbers.push({ o: boat, baseY: 0.1, amp: 0.18, speed: 1.3, phase: x });
    }
    // Pondok beratap rumbia.
    for (const [x, z] of [[-13, -11.5], [16, -12]] as const) {
      const hut = house(4.2, 3.0, 3.4, 0xd9b98a, 0xb5893f, look.glow);
      this.add(hut, x, -0.3, z);
    }
    // Payung pantai warna-warni.
    const umbrellas: Array<[number, number, number, number]> = [
      [-8.5, -9.2, 0xff5a3c, 0xfffaf0], [-3, -10.4, 0x2fb4d6, 0xffd23f], [4.5, -9.4, 0xffd23f, 0xff5a3c], [10, -10.2, 0x7dbb5a, 0xfffaf0],
    ];
    for (const [x, z, a, b] of umbrellas) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), toon(0xfffaf0));
      pole.position.y = 1.3;
      g.add(pole);
      const top = stripedCone(1.5, 0.7, a, b, 10);
      top.position.y = 2.75;
      g.add(top);
      g.rotation.z = ((x * 7) % 3) * 0.06 - 0.06;
      this.add(g, x, -0.3, z);
    }
    for (const [x, z, h] of [[-19, -9.5, 8], [-11, -8, 6.5], [7.5, -8, 7], [13, -8.6, 6], [20, -10, 8.5]] as const) {
      const p = palm(h);
      p.rotation.y = x;
      this.add(p, x, -0.3, z);
    }
    // Istana pasir kecil dan bola pantai.
    const castle = new THREE.Group();
    for (const [x, h] of [[-0.5, 0.7], [0, 1.0], [0.5, 0.7]] as const) {
      const t = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 8), toon(0xe6c684)), 0.03);
      t.position.set(x, h / 2, 0);
      castle.add(t);
      const c = addOutline(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.3, 8), toon(0xd9b877)), 0.03);
      c.position.set(x, h + 0.15, 0);
      castle.add(c);
    }
    this.add(castle, -11.3, -0.3, 2.6);
    this.target = this.root;
    const beachBall = addOutline(new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), toon(0xff5a3c)), 0.04);
    this.add(beachBall, 11.4, 0.15, 2.9);
  }

  // Properti pantai dari model 3D (3DGarden). Daftar: [model, x, z, skala, putaran, mengapung].
  private async loadPantai(fallback: THREE.Group, id: number): Promise<void> {
    const G = -0.3;
    const list: Array<[string, number, number, number, number, boolean?]> = [
      ["palm-tree-09", -19.5, -9.6, 2.1, 0.4],
      ["palm-tree-05", -11.2, -8.2, 1.9, 2.1],
      ["palm-tree-13", 7.4, -8.2, 1.9, 4.0],
      ["palm-tree-05", 13.2, -8.8, 1.7, 5.2],
      ["palm-tree-09", 20.5, -10.2, 2.2, 1.3],
      ["palm-tree-13", -24, -13, 2.0, 0.9],
      ["cabin-02", -14.5, -12.5, 1.5, 0.35],
      ["cabin-03", 17.5, -12.8, 1.5, -0.35],
      ["shop-02", 1.8, -12.6, 1.7, 0],
      ["life-guard-chair-01", -6.2, -13.6, 1.6, 0.2],
      ["beach-umbrella-01", -8.6, -9.3, 1.6, 0],
      ["beach-umbrella-02-2", -2.9, -10.2, 1.6, 1],
      ["beach-umbrella-03", 4.6, -9.5, 1.6, 2],
      ["beach-umbrella-01", 10.2, -10.4, 1.6, 3],
      ["beach-chair-01", -7.5, -9.0, 1.5, 0.3],
      ["beach-chair-05", -2.0, -9.6, 1.5, -0.2],
      ["beach-chair-01", 5.6, -9.0, 1.5, -0.4],
      ["beach-chair-05", 11.2, -9.9, 1.5, 0.2],
      ["surfboard-05", -17.6, -8.6, 1.5, 0.3],
      ["surfboard-02", 15.4, -8.4, 1.5, -0.2],
      ["picnic-table-01", 7.6, -12.8, 1.4, 0.4],
      ["dock-02", -1.5, -19.5, 1.7, Math.PI / 2],
      ["buoy-pack-01", 8.5, -19.5, 1.6, 0.5, true],
      ["rowboat", 3.4, -21.5, 1.8, 0.7, true],
      ["sailboat", -17, -25, 2.6, 0.5, true],
      ["raft", -8.5, -28, 1.9, 1.1, true],
      ["boat-02", 14.5, -31, 2.4, -0.6, true],
    ];
    try {
      const { getModel, stand } = await import("./models");
      const group = new THREE.Group();
      const floats: THREE.Object3D[] = [];
      await Promise.all(
        list.map(async ([slug, x, z, scale, rot, floating]) => {
          const m = await getModel(slug);
          stand(m, x, floating ? -0.42 : G, z, scale, rot);
          group.add(m);
          if (floating) floats.push(m);
        }),
      );
      if (id !== this.buildId) return; // arena sudah diganti selagi memuat
      this.root.remove(fallback);
      fallback.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (o.name !== "outline") (o.material as THREE.Material).dispose();
        }
      });
      this.bobbers = this.bobbers.filter((b) => b.o.parent !== fallback);
      this.root.add(group);
      for (const m of floats) {
        this.bobbers.push({ o: m, baseY: m.position.y, amp: 0.12, speed: 1.2, phase: m.position.x });
      }
    } catch {
      // gagal dimuat (misalnya tanpa internet di kunjungan pertama): cadangan tetap tampil
    }
  }

  private buildPasarMalam(look: Look): void {
    this.hills(look, [[-26, -40, 22, 0x4a5a78], [20, -44, 26, 0x435270]]);
    const glow = Math.max(look.glow, 0.35); // lampu pasar malam tetap menyala walau siang

    // Bianglala.
    const wheel = new THREE.Group();
    const R = 6.2;
    const rim = addOutline(new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 6, 40), toon(0xff5a3c)), 0.05);
    wheel.add(rim);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.08, 5, 30), toon(0xffd23f)));
    const cabinColors = [0xff5a3c, 0xffd23f, 0x2fb4d6, 0x7dbb5a, 0xff8ad8, 0x9a66e0, 0xfffaf0, 0x4a7de0];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, R, 5), toon(0xfffaf0));
      spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 0);
      spoke.rotation.z = a - Math.PI / 2;
      wheel.add(spoke);
      const cabin = new THREE.Group();
      const box = addOutline(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, 0.8), toon(cabinColors[k])), 0.04);
      box.position.y = -0.6;
      cabin.add(box);
      const top = addOutline(new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.4, 4), toon(0xfffaf0)), 0.03);
      top.rotation.y = Math.PI / 4;
      top.position.y = 0.02;
      cabin.add(top);
      cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      wheel.add(cabin);
      this.upright.push(cabin);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), bulbMat);
      bulb.position.set(Math.cos(a + 0.39) * R, Math.sin(a + 0.39) * R, 0.1);
      wheel.add(bulb);
      this.blinkers.push({ m: bulbMat, on: 0xfff2b0, off: shade(0xfff2b0, 1 - glow * 0.6), phase: k * 2 });
    }
    this.add(wheel, -11.5, 7.6, -15);
    this.spinners.push({ o: wheel, axis: "z", speed: 0.16 });
    for (const sx of [-1, 1]) {
      const leg = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 8.6, 6), toon(0x6a6478)), 0.05);
      leg.rotation.z = sx * 0.28;
      this.add(leg, -11.5 + sx * 1.3, 3.7, -15.4);
    }

    // Tenda sirkus bergaris dan tenda-tenda warung.
    const big = new THREE.Group();
    const drum = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 3, 16), toon(0xfffaf0)), 0.06);
    drum.position.y = 1.5;
    big.add(drum);
    const cone = stripedCone(4.7, 3.6, 0xe5392d, 0xfffaf0, 16);
    cone.position.y = 4.8;
    big.add(cone);
    const pennant = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, -0.25), new THREE.Vector2(0, -0.5)])),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }),
    );
    pennant.position.y = 7.5;
    big.add(pennant);
    this.flags.push(pennant);
    this.add(big, 10.5, -0.3, -15);
    const stalls: Array<[number, number, number, number]> = [
      [-3.5, -11.5, 0x2fb4d6, 0xfffaf0], [2.6, -12.4, 0xffd23f, 0xff5a3c], [18.5, -11, 0x7dbb5a, 0xfffaf0], [-19.5, -10.5, 0xff8ad8, 0xfffaf0],
    ];
    for (const [x, z, a, b] of stalls) {
      const s = new THREE.Group();
      const counter = addOutline(new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.3, 1.6), toon(0x8a5a3a)), 0.05);
      counter.position.y = 0.65;
      s.add(counter);
      const top = stripedCone(2.4, 1.5, a, b, 8);
      top.position.y = 3.5;
      s.add(top);
      for (const px of [-1.3, 1.3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 5), toon(0xfffaf0));
        post.position.set(px, 1.45, 0.6);
        s.add(post);
      }
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), lampMat);
      lamp.position.set(0, 2.5, 0.5);
      s.add(lamp);
      this.blinkers.push({ m: lampMat, on: 0xfff2b0, off: shade(0xfff2b0, 1 - glow * 0.35), phase: x });
      this.add(s, x, -0.3, z);
    }

    // Komidi putar kecil.
    const carousel = new THREE.Group();
    const base = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.4, 16), toon(0xffd23f)), 0.05);
    base.position.y = 0.2;
    carousel.add(base);
    const roof = stripedCone(2.7, 1.5, 0x2fb4d6, 0xfffaf0, 12);
    roof.position.y = 4.1;
    carousel.add(roof);
    const ring = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 5), toon(0xfffaf0));
      pole.position.set(Math.cos(a) * 1.7, 1.9, Math.sin(a) * 1.7);
      ring.add(pole);
      const horse = addOutline(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), toon(cabinColors[k])), 0.03);
      horse.rotation.z = Math.PI / 2;
      horse.position.set(Math.cos(a) * 1.7, 1.3 + (k % 2) * 0.4, Math.sin(a) * 1.7);
      ring.add(horse);
    }
    carousel.add(ring);
    this.spinners.push({ o: ring, axis: "y", speed: 0.7 });
    this.add(carousel, 3.5, -0.3, -17.5);

    // Lampion melayang di antara tiang.
    for (let k = 0; k < 9; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: cabinColors[k % cabinColors.length] });
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat);
      lantern.scale.y = 1.25;
      const x = -18 + k * 4.5;
      this.add(lantern, x, 6.2 + (k % 3) * 0.7, -8.6);
      this.bobbers.push({ o: lantern, baseY: 6.2 + (k % 3) * 0.7, amp: 0.2, speed: 1.1, phase: k * 1.3 });
      this.blinkers.push({ m: mat, on: cabinColors[k % cabinColors.length], off: shade(cabinColors[k % cabinColors.length], 1 - glow * 0.3), phase: k * 3 + 1 });
    }
  }

  private buildSekolah(look: Look): void {
    this.hills(look, [[-30, -44, 24, 0x6aa85a], [26, -46, 28, 0x5d9c58]]);
    // Gedung sekolah dua lantai dengan deretan jendela.
    const school = new THREE.Group();
    const W = 30;
    const body = addOutline(new THREE.Mesh(new THREE.BoxGeometry(W, 7, 5), toon(0xf7e7b6)), 0.07);
    body.position.y = 3.5;
    body.castShadow = true;
    school.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.5, 5.1), toon(0x2f9e6b));
    band.position.y = 3.4;
    school.add(band);
    const roof = addOutline(new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.9, 6.2), toon(0xc5563a)), 0.06);
    roof.position.y = 7.4;
    school.add(roof);
    const winMat = look.glow > 0 ? lit(0xffe08a, look.glow, 0xbfe6f5) : toon(0xbfe6f5);
    for (let floor = 0; floor < 2; floor++) {
      for (let k = 0; k < 9; k++) {
        const x = -W / 2 + 2 + k * 3.25;
        if (floor === 0 && k === 4) continue; // pintu utama
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 0.06), winMat);
        win.position.set(x, 1.7 + floor * 3.4, 2.53);
        school.add(win);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.2), toon(0xfffaf0));
        sill.position.set(x, 0.9 + floor * 3.4, 2.6);
        school.add(sill);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.9, 0.08), toon(0x7d4a36));
    door.position.set(-W / 2 + 2 + 4 * 3.25, 1.45, 2.54);
    school.add(door);
    const sign = addOutline(new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 0.15), toon(0x2f9e6b)), 0.04);
    sign.position.set(0, 8.3, 2.6);
    school.add(sign);
    // Jam dinding di tengah.
    const clock = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0xfffaf0 }));
    clock.position.set(0, 6.1, 2.56);
    school.add(clock);
    for (const [len, rot] of [[0.42, 0.6], [0.3, -1.2]] as const) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.02), new THREE.MeshBasicMaterial({ color: 0x17131c }));
      hand.geometry.translate(0, len / 2, 0);
      hand.rotation.z = rot;
      hand.position.set(0, 6.1, 2.58);
      school.add(hand);
    }
    this.add(school, 0, -0.3, -15);

    // Tiang bendera merah putih.
    const pole = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9.5, 8), toon(0xd8dde4)), 0.03);
    this.add(pole, -12.5, 4.45, -8.5);
    const flagGeo = new THREE.PlaneGeometry(2.4, 0.75, 6, 1);
    flagGeo.translate(1.2, 0, 0);
    const red = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xe5392d, side: THREE.DoubleSide }));
    this.add(red, -12.45, 8.75, -8.5);
    const white = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xfffaf0, side: THREE.DoubleSide }));
    this.add(white, -12.45, 8.0, -8.5);
    this.flags.push(red, white);

    // Ring basket.
    const hoop = new THREE.Group();
    const post = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.6, 8), toon(0x4a7de0)), 0.04);
    post.position.y = 2.3;
    hoop.add(post);
    const board = addOutline(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.1), toon(0xfffaf0)), 0.04);
    board.position.set(0, 4.3, 0.3);
    hoop.add(board);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 5, 16), toon(0xff5a3c));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 3.9, 0.75);
    hoop.add(rim);
    hoop.rotation.y = -0.5;
    this.add(hoop, 13, -0.3, -8.5);

    // Pohon rindang dan pagar.
    for (const [x, z, h, c] of [[-21, -10, 3.2, 0x4f9a52], [19.5, -10.5, 3.6, 0x3f8f4a], [-17, -20, 4, 0x58a658], [24, -21, 4.2, 0x4f9a52]] as const) {
      this.add(tree(h, shade(c, Math.max(0.6, look.dim))), x, -0.3, z);
    }
    const fenceMat = toon(0xfffaf0);
    for (let k = 0; k < 24; k++) {
      const x = -23 + k * 2;
      if (Math.abs(x) < 9) continue;
      const picket = addOutline(new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.12), fenceMat), 0.03);
      this.add(picket, x, 0.45, -7.2);
    }
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.14, 0.08), fenceMat);
      this.add(rail, sx * 16.2, 0.75, -7.25);
    }
    // Bangku taman dan tong sampah warna.
    for (const [x, c] of [[-10.6, 0x2f9e6b], [10.6, 0xffd23f]] as const) {
      const bin = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.0, 10), toon(c)), 0.04);
      this.add(bin, x, 0.2, 3.1);
    }
  }

  // Penonton melonjak bersama selama beberapa saat.
  cheer(seconds = 1.2): void {
    this.cheerUntil = Math.max(this.cheerUntil, performance.now() / 1000 + seconds);
  }

  update(timeSec: number, excite = 0): void {
    // Penonton memantul; makin tegang makin cepat dan tinggi.
    const cheering = timeSec < this.cheerUntil;
    const amp = cheering ? 0.55 : 0.04 + excite * 0.28;
    const speed = cheering ? 13 : 4 + excite * 7;
    for (const fan of this.fans) {
      const hop = Math.abs(Math.sin(timeSec * speed + fan.phase));
      fan.body.position.y = fan.baseY + hop * amp;
      fan.body.scale.y = 1 + hop * amp * 0.25;
      fan.body.rotation.z = Math.sin(timeSec * speed * 0.5 + fan.phase) * (cheering ? 0.2 : 0.05 + excite * 0.1);
    }

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += 0.004 * (1 + i * 0.3);
      if (c.position.x > 48) c.position.x = -48;
    }
    // Bendera berkibar; ikut waktu nyata supaya tetap hidup saat hitstop.
    const step = Math.floor(timeSec * 10);
    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i].rotation.x = Math.sin(step * 0.5 + i * 0.9) * 0.3;
      this.flags[i].rotation.z = Math.sin(step * 0.35 + i * 1.7) * 0.12;
    }
    for (const s of this.spinners) {
      s.o.rotation[s.axis] = timeSec * s.speed;
    }
    // Kabin bianglala melawan putaran rodanya supaya tetap tegak.
    for (const cabin of this.upright) cabin.rotation.z = -(cabin.parent?.rotation.z ?? 0);
    for (const b of this.bobbers) {
      b.o.position.y = b.baseY + Math.sin(timeSec * b.speed + b.phase) * b.amp;
      b.o.rotation.z = Math.sin(timeSec * b.speed * 0.7 + b.phase) * 0.05;
    }
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      w.position.z = -17 - i * 5.5 + Math.sin(timeSec * 0.6 + i * 1.4) * 1.2;
    }
    const tick = Math.floor(timeSec * 3);
    for (const b of this.blinkers) {
      b.m.color.setHex((tick + Math.floor(b.phase)) % 3 === 0 ? b.off : b.on);
    }
  }
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
