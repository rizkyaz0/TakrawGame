import * as THREE from "three";
import type { AnimKind } from "./animator";
import { FoodCharacter } from "./foodchar";
import { Fx } from "./fx";
import { Scenery, type ArenaId, type TimeId } from "./scenery";
import {
  AIM_MAX,
  BALL_R,
  BODY_Y,
  CHARS,
  COURT_HALF,
  GUARD_R,
  HEAT_MAX,
  SMASH_R,
  SPECIAL_R,
  sideOf,
  smashDir,
  type GameEvent,
  type GameState,
} from "./sim";
import { addOutline, styleUniforms, toon } from "./style";

const FOV = 32;
const VIEW_W = COURT_HALF * 2 + 1.8;
const VIEW_H = 9.6;
const LOOK_Y = 3.7;

interface PlayerView {
  cue: THREE.Mesh; // cincin petunjuk "tekan sekarang" (mode latihan)
  char: FoodCharacter | null;
  ring: THREE.Mesh;
  disc: THREE.Mesh; // alas warna tim di lantai (mode tim)
  tag: THREE.Mesh; // panah di atas kepala pemain yang dimainkan orang (mode tim)
  aim: THREE.Mesh; // panah bidik smash tahan-bidik
}

// Di mode tim, anggota tim berdiri sedikit berbeda kedalamannya supaya tidak saling menutupi.
const TEAM_Z = [0, -0.85, 0.85];
const TEAM_COLORS = [0xff5a3c, 0x4a7de0];

// Tekstur bola rotan anyaman, digambar ke canvas.
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f2cf4e";
  g.fillRect(0, 0, 256, 128);
  g.lineCap = "round";
  for (const [color, width] of [["#8c6414", 13], ["#f7e08a", 5]] as const) {
    g.strokeStyle = color;
    g.lineWidth = width;
    for (let i = -6; i < 14; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0);
      g.lineTo(i * 32 + 96, 128);
      g.stroke();
      g.beginPath();
      g.moveTo(i * 32 + 96, 0);
      g.lineTo(i * 32, 128);
      g.stroke();
    }
  }
  g.fillStyle = "#3a2a0c";
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 9; x++) {
      g.beginPath();
      g.arc(x * 32 + (y % 2) * 16, 21 + y * 43, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 300);
  private scenery: Scenery;
  private fx: Fx;
  private players: PlayerView[] = [];
  private ball: THREE.Mesh;
  private ballMat: THREE.MeshToonMaterial;
  private marker: THREE.Mesh;
  private reticle: THREE.Group; // bidikan penonton, terlihat semua pemain
  private reticleMat = new THREE.MeshBasicMaterial({ color: 0x7dff6a, transparent: true, opacity: 0.9 });
  private ray = new THREE.Raycaster();
  // Benda lemparan penonton: tiap slot punya kulit pisang, sandal, dan tanda peringatan.
  private hazardViews: Array<{ peel: THREE.Group; sandal: THREE.Group; warn: THREE.Mesh }> = [];
  private camDist = 20;
  private camX = 0;
  private camY = LOOK_Y;
  private camZoom = 1;
  private shake = 0;
  private focus = -1; // pemain yang sedang disorot saat layar membeku sebelum ulti
  // Petunjuk timing per pemain: "smash" (emas), "guard" (biru), atau null.
  cues: Array<"smash" | "guard" | null> = [null, null];
  shakeScale = 1; // dikecilkan lewat pengaturan "efek layar dikurangi"
  humanSlots: number[] = []; // nomor pemain yang dimainkan orang di perangkat ini, urut P1, P2
  private sun!: THREE.DirectionalLight;
  private fullRatio = 1;

  // Grafis hemat: resolusi 1x dan tanpa bayangan, untuk HP yang berat.
  setLowGfx(low: boolean): void {
    this.renderer.setPixelRatio(low ? 1 : this.fullRatio);
    this.sun.castShadow = !low;
    styleUniforms.uPx.value = this.renderer.getPixelRatio();
  }

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // HP: resolusi dan bayangan diturunkan supaya tetap lancar.
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    this.fullRatio = Math.min(window.devicePixelRatio, mobile ? 1.5 : 2);
    this.renderer.setPixelRatio(this.fullRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.prepend(this.renderer.domElement);
    styleUniforms.uPx.value = this.renderer.getPixelRatio();

    const hemi = new THREE.HemisphereLight(0xfff6e0, 0x8a7fa8, 1.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.set(-7, 15, 9);
    sun.castShadow = true;
    this.sun = sun;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.scenery = new Scenery(this.scene, hemi, sun);
    this.fx = new Fx(this.scene);

    this.ballMat = toon(0xffffff, { map: ballTexture() });
    this.ball = addOutline(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), this.ballMat), 0.03);
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    // Penanda di lantai tepat di bawah bola, membantu membaca posisi.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.32, 20),
      new THREE.MeshBasicMaterial({ color: 0x17131c, transparent: true, opacity: 0.55 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.scene.add(this.marker);

    this.reticle = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 24), this.reticleMat);
    rim.rotation.x = -Math.PI / 2;
    this.reticle.add(rim);
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.07), this.reticleMat);
      bar.rotation.y = rot;
      this.reticle.add(bar);
    }
    const pole = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), this.reticleMat);
    pole.rotation.x = Math.PI;
    pole.position.y = 3.4;
    this.reticle.add(pole);
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    for (let k = 0; k < 4; k++) {
      const peel = new THREE.Group();
      const peelMat = toon(0xf6cf2f);
      for (let n = 0; n < 4; n++) {
        const flap = addOutline(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 5), peelMat), 0.02);
        flap.scale.z = 0.45;
        flap.rotation.z = Math.PI / 2 - 0.25;
        flap.position.x = 0.2;
        const arm = new THREE.Group();
        arm.rotation.y = (n / 4) * Math.PI * 2;
        arm.add(flap);
        peel.add(arm);
      }
      peel.add(addOutline(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), toon(0x6b4a22)), 0.015));

      const sandal = new THREE.Group();
      const sole = addOutline(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), toon(0x2fb4d6)), 0.03);
      sole.scale.set(1.1, 0.2, 0.5);
      sandal.add(sole);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 5, 10, Math.PI), toon(0xfffaf0));
      strap.position.set(0.1, 0.03, 0);
      strap.rotation.y = Math.PI / 2;
      sandal.add(strap);

      const warn = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.5, 20),
        new THREE.MeshBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.85 }),
      );
      warn.rotation.x = -Math.PI / 2;
      for (const o of [peel, sandal, warn]) {
        o.visible = false;
        this.scene.add(o);
      }
      this.hazardViews.push({ peel, sandal, warn });
    }

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // Tampilan pemain dibuat atau dibuang mengikuti jumlah pemain di state (2, 4, atau 6).
  private syncPlayers(count: number): void {
    while (this.players.length < count) {
      const i = this.players.length;
      // Cincin jangkauan smash/special; karakternya dibuat saat draw pertama.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(SMASH_R, 0.04, 6, 36),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
      );
      ring.visible = false;
      this.scene.add(ring);
      const cue = new THREE.Mesh(
        new THREE.TorusGeometry(SMASH_R * 1.22, 0.07, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95 }),
      );
      cue.visible = false;
      this.scene.add(cue);
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.56, 24),
        new THREE.MeshBasicMaterial({ color: TEAM_COLORS[sideOf(i)], transparent: true, opacity: 0.85 }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.visible = false;
      this.scene.add(disc);
      const tag = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      tag.rotation.x = Math.PI;
      tag.visible = false;
      this.scene.add(tag);
      // Panah bidik: dari pusat bola ke arah lepasan smash, menghadap kamera.
      const arrowShape = new THREE.Shape();
      arrowShape.moveTo(0.5, -0.09);
      arrowShape.lineTo(1.45, -0.09);
      arrowShape.lineTo(1.45, -0.26);
      arrowShape.lineTo(1.95, 0);
      arrowShape.lineTo(1.45, 0.26);
      arrowShape.lineTo(1.45, 0.09);
      arrowShape.lineTo(0.5, 0.09);
      arrowShape.closePath();
      const aim = new THREE.Mesh(
        new THREE.ShapeGeometry(arrowShape),
        new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.92, depthTest: false, side: THREE.DoubleSide }),
      );
      aim.renderOrder = 20;
      // Garis tepi gelap di belakang panah supaya terbaca di latar apa pun.
      const edge = new THREE.Shape();
      edge.moveTo(0.4, -0.15);
      edge.lineTo(1.35, -0.15);
      edge.lineTo(1.35, -0.36);
      edge.lineTo(2.1, 0);
      edge.lineTo(1.35, 0.36);
      edge.lineTo(1.35, 0.15);
      edge.lineTo(0.4, 0.15);
      edge.closePath();
      const back = new THREE.Mesh(
        new THREE.ShapeGeometry(edge),
        new THREE.MeshBasicMaterial({ color: 0x17131c, depthTest: false, side: THREE.DoubleSide }),
      );
      back.renderOrder = 19;
      back.position.z = -0.01;
      aim.add(back);
      aim.visible = false;
      this.scene.add(aim);
      this.players.push({ cue, char: null, ring, disc, tag, aim });
    }
    while (this.players.length > count) {
      const v = this.players.pop()!;
      for (const o of [v.cue, v.ring, v.disc, v.tag, v.aim]) {
        this.scene.remove(o);
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      if (v.char) {
        this.scene.remove(v.char.root);
        v.char.dispose();
      }
    }
  }

  // Ganti latar dan waktu.
  setArena(arena: ArenaId, time: TimeId): void {
    if (this.scenery.arena !== arena || this.scenery.time !== time) this.scenery.set(arena, time);
  }
  get arena(): ArenaId {
    return this.scenery.arena;
  }
  get time(): TimeId {
    return this.scenery.time;
  }

  // Potret karakter untuk layar pilih jagoan: model 3D-nya digambar ke gambar kecil.
  // bare: hanya badan; front: menghadap lurus ke kamera (untuk gambar acuan model 3D).
  portrait(charId: number, size = 160, bare = false, front = false): string {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x8a7fa8, 1.7));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    key.position.set(4, 6, 5);
    scene.add(key);
    const ch = new FoodCharacter(charId, bare);
    ch.pose(front ? -Math.PI / 2 : -0.7);
    scene.add(ch.root);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    if (bare) {
      // Gambar acuan: tanpa garis tepi dan arsiran, badan pas di tengah bingkai.
      ch.root.traverse((o) => {
        if (o.name === "outline") o.visible = false;
      });
      ch.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(ch.root);
      const center = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3());
      const dist = (Math.max(sz.x, sz.y, sz.z) / 2 / Math.tan(THREE.MathUtils.degToRad(13))) * 1.2;
      const dir = front ? new THREE.Vector3(0, 0.06, 1) : new THREE.Vector3(0.65, 0.22, 0.72);
      cam.position.copy(center).addScaledVector(dir.normalize(), dist);
      cam.lookAt(center);
    } else {
      // Potret kartu pilih jagoan: bingkai mengikuti ukuran karakter supaya topi dan hiasan tidak terpotong.
      ch.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(ch.root);
      const center = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3());
      const dist = (Math.max(sz.x, sz.y, sz.z) / 2 / Math.tan(THREE.MathUtils.degToRad(13))) * 1.1;
      const dir = front ? new THREE.Vector3(0, 0.1, 1) : new THREE.Vector3(0.65, 0.2, 0.72);
      cam.position.copy(center).addScaledVector(dir.normalize(), dist);
      cam.lookAt(center);
    }
    const sketchBefore = styleUniforms.uSketch.value;
    if (bare) styleUniforms.uSketch.value = 0;
    const target = new THREE.WebGLRenderTarget(size * 2, size * 2, { samples: 4 });
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearAlpha(0);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(size * 2 * size * 2 * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, size * 2, size * 2, px);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearAlpha(prevClear);
    styleUniforms.uSketch.value = sketchBefore;
    target.dispose();
    ch.dispose();
    // Hasil bacaan terbalik secara vertikal dan masih linear: balik dan ubah ke sRGB.
    const big = document.createElement("canvas");
    big.width = big.height = size * 2;
    const g = big.getContext("2d")!;
    const img = g.createImageData(size * 2, size * 2);
    const W = size * 2;
    const toSrgb = (v: number) => Math.round(255 * Math.pow(v / 255, 1 / 2.2));
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const src = ((W - 1 - y) * W + x) * 4;
        const dst = (y * W + x) * 4;
        img.data[dst] = toSrgb(px[src]);
        img.data[dst + 1] = toSrgb(px[src + 1]);
        img.data[dst + 2] = toSrgb(px[src + 2]);
        img.data[dst + 3] = px[src + 3];
      }
    }
    g.putImageData(img, 0, 0);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    out.getContext("2d")!.drawImage(big, 0, 0, size, size);
    return out.toDataURL("image/png");
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camDist = Math.max(VIEW_W / 2 / (t * this.camera.aspect), VIEW_H / 2 / t);
    this.camera.updateProjectionMatrix();
  }

  private playAnim(i: number, kind: AnimKind, f: number, roll = false): void {
    this.players[i].char?.play(kind, f, roll);
  }

  private strikeAnim(i: number, kind: AnimKind, s: GameState, x: number, y: number): void {
    this.players[i].char?.strike(kind, s.frame, s.players[i], x, y);
  }

  // Efek visual untuk event simulasi (suara dan HUD ditangani di main).
  handleEvent(e: GameEvent, s: GameState): void {
    const f = s.frame;
    const feet = (i: number) => s.players[i];
    switch (e.type) {
      case "touch":
        this.strikeAnim(e.player, "touch", s, e.x, e.y);
        if (e.weak) {
          this.fx.burst(f, e.x, e.y, 0x8a7fa8, 0.9);
          this.shake = Math.max(this.shake, 0.3);
        } else {
          this.fx.burst(f, e.x, e.y, 0xffffff, 0.45);
        }
        break;
      case "guard":
        this.playAnim(e.player, "guard", f);
        break;
      case "receive":
        this.strikeAnim(e.player, "guard", s, e.x, e.y);
        this.fx.burst(f, e.x, e.y, e.perfect ? 0xffffff : 0x7fd4ff, e.perfect ? 1.3 : 0.8);
        if (e.perfect) this.fx.burst(f, e.x, e.y, 0x7fd4ff, 0.8);
        break;
      case "whiff":
        {
          // Smash di udara dengan bola di atas kepala jadi roll spike (salto).
          const pl = s.players[e.player];
          const roll = !pl.grounded && pl.y > 0.5 && s.ball.y - pl.y > 1.5;
          this.playAnim(e.player, "smash", f, roll);
        }
        break;
      case "special":
        // Gerakan jurusnya baru dimainkan saat bola kena; sebelum itu karakter bersiaga.
        this.focus = e.player;
        break;
      case "smash":
        this.strikeAnim(e.player, "smash", s, e.x, e.y);
        if (e.perfect) {
          this.fx.burst(f, e.x, e.y, 0xffd23f, 1.7);
          this.fx.burst(f, e.x, e.y, CHARS[s.chars[e.player]].color, 1.0);
          this.shake = Math.max(this.shake, 0.5);
        } else {
          this.fx.burst(f, e.x, e.y, CHARS[s.chars[e.player]].color, 1.05);
          this.shake = Math.max(this.shake, 0.25 + Math.min(s.heat, HEAT_MAX) * 0.008);
        }
        break;
      case "specialHit":
        this.strikeAnim(e.player, "special", s, e.x, e.y);
        this.fx.burst(f, e.x, e.y, CHARS[s.chars[e.player]].color, 1.5);
        this.shake = Math.max(this.shake, 0.7);
        break;
      case "curveDrop":
        this.fx.burst(f, s.ball.x, s.ball.y, 0x4dffd2, 0.9);
        break;
      case "bounce":
        this.fx.burst(f, s.ball.x, s.ball.y, 0xffffff, 0.35);
        break;
      case "heckle":
        this.scenery.cheer(0.5);
        break;
      case "slip":
        this.fx.dust(f, feet(e.player).x, 0, 7);
        this.fx.burst(f, feet(e.player).x, 0.4, 0xffd23f, 0.9);
        this.shake = Math.max(this.shake, 0.2);
        break;
      case "bonk":
        this.fx.burst(f, e.x, e.y, 0x2fb4d6, 0.8);
        this.shake = Math.max(this.shake, 0.15);
        break;
      case "jump":
        this.fx.dust(f, feet(e.player).x, feet(e.player).y, 3);
        break;
      case "land":
        this.fx.dust(f, feet(e.player).x, 0, 5);
        break;
      case "dash":
        this.fx.dust(f, feet(e.player).x, feet(e.player).y, 4, e.dir);
        break;
      case "score":
        if (!e.fault) {
          this.fx.burst(f, s.ball.x, 0.3, 0xffe45c, 1.5);
          this.fx.dust(f, s.ball.x, 0, 6);
        }
        this.shake = Math.max(this.shake, 0.15);
        break;
    }
  }

  // Posisi x di lapangan untuk satu titik di layar (bidikan mouse penonton).
  worldX(clientX: number, clientY: number): number {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (Math.abs(d.z) < 1e-6) return 0;
    return o.x + d.x * (-o.z / d.z); // titik potong dengan bidang z = 0
  }

  // Penonton melonjak (poin, smash sempurna, ulti).
  cheer(seconds?: number): void {
    this.scenery.cheer(seconds);
  }

  draw(s: GameState, excite = 0): void {
    const now = performance.now() / 1000;
    // Goresan berganti 8 kali per detik: efek "boil" gambar tangan.
    styleUniforms.uBoil.value = Math.floor(now * 8) % 16;

    // Sorotan ulti berakhir begitu layar tidak lagi membeku.
    if (s.hitstop === 0) this.focus = -1;

    this.syncPlayers(s.players.length);
    const teamMode = s.players.length > 2;
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      const v = this.players[i];
      const z = teamMode ? TEAM_Z[i >> 1] : 0;

      // Karakter dibangun ulang kalau pemain ganti karakter.
      if (!v.char || v.char.charId !== s.chars[i]) {
        if (v.char) {
          this.scene.remove(v.char.root);
          v.char.dispose();
        }
        v.char = new FoodCharacter(s.chars[i]);
        this.scene.add(v.char.root);
      }
      // Setelah poin: pencetak poin selebrasi, lawannya lesu.
      const decided = s.phase === "point" || s.phase === "over";
      const mood = !decided ? null : s.server === sideOf(i) ? "win" : "lose";
      v.char.update(p, s.frame, s.ball, this.focus === i || p.specialTimer > 0, mood);
      v.char.root.position.z = z;
      v.disc.visible = teamMode;
      v.disc.position.set(p.x, 0.03, z);
      const human = this.humanSlots.indexOf(i);
      v.tag.visible = teamMode && human >= 0;
      v.tag.position.set(p.x, p.y + 2.25 + Math.sin(now * 5) * 0.07, z);
      (v.tag.material as THREE.MeshBasicMaterial).color.setHex(human === 1 ? 0x4dffd2 : 0xffd23f);

      const c = CHARS[s.chars[i]];
      const special = p.specialTimer > 0;
      const cueKind = this.cues[i] ?? null;
      v.cue.visible = cueKind !== null;
      v.cue.position.set(p.x, p.y + BODY_Y, z + 0.05);
      (v.cue.material as THREE.MeshBasicMaterial).color.setHex(cueKind === "guard" ? 0x7fd4ff : 0xffd23f);
      v.cue.scale.setScalar(1 + Math.sin(now * 40) * 0.04);

      // Panah bidik: terlihat oleh semua pemain selama smash ditahan.
      const aiming = p.aimTimer > 0;
      v.aim.visible = aiming;
      if (aiming) {
        const [ux, uy] = smashDir(p.grounded, p.aimX, p.aimY, sideOf(i) === 0 ? 1 : -1);
        v.aim.position.set(s.ball.x, s.ball.y, z + 0.3);
        v.aim.rotation.z = Math.atan2(uy, ux);
        v.aim.scale.setScalar(0.85 + Math.sin(now * 18) * 0.06 + (AIM_MAX - p.aimTimer) * 0.004);
        (v.aim.material as THREE.MeshBasicMaterial).color.setHex(
          p.aimPerfect ? 0xfff3a0 : c.color,
        );
      }

      const guarding = p.guardTimer > 0;
      v.ring.visible = special || guarding || p.smashTimer > 0;
      v.ring.position.set(p.x, p.y + BODY_Y, z);
      v.ring.scale.setScalar(special ? SPECIAL_R / SMASH_R : guarding ? GUARD_R / SMASH_R : 1);
      v.ring.rotation.z = Math.floor(s.frame / 2) * 0.4;
      (v.ring.material as THREE.MeshBasicMaterial).color.setHex(special ? c.color : guarding ? 0x7fd4ff : 0xffffff);
    }

    const b = s.ball;
    const speed = Math.hypot(b.vx, b.vy);
    this.ball.position.set(b.x, b.y, 0);
    if (s.hitstop === 0) this.ball.rotation.z -= b.vx * 0.03;
    // Bola melar searah lajunya kalau sedang kencang.
    const stretch = 1 + Math.min(0.45, Math.max(0, speed - 10) * 0.03);
    if (speed > 10) this.ball.rotation.z = Math.atan2(b.vy, b.vx);
    const big = b.power > 0 || b.rise > 0 ? 1.3 : b.curveSide >= 0 || b.wave > 0 ? 1.12 : 1;
    this.ball.scale.set(stretch * big, big / Math.sqrt(stretch), big / Math.sqrt(stretch));
    if (b.rise > 0) {
      this.ballMat.emissive.setHex(0x7ed23a);
      this.ballMat.emissiveIntensity = 1.3;
    } else if (b.power > 0) {
      this.ballMat.emissive.setHex(0xff4a00);
      this.ballMat.emissiveIntensity = 1.6;
    } else if (b.curveSide >= 0) {
      this.ballMat.emissive.setHex(0x1fe0b4);
      this.ballMat.emissiveIntensity = 1.1;
    } else if (b.wave > 0) {
      this.ballMat.emissive.setHex(0x9a66e0);
      this.ballMat.emissiveIntensity = 1.3;
    } else {
      // Makin panas relinya, makin membara bolanya.
      this.ballMat.emissive.setHex(0xff5a00);
      this.ballMat.emissiveIntensity = (Math.min(s.heat, HEAT_MAX) / HEAT_MAX) * 0.9;
    }
    // Bola Siluman: nyaris tak terlihat, berkedip samar; penanda lantai ikut hilang.
    const ghost = b.ghost > 0;
    this.ballMat.transparent = ghost;
    this.ballMat.opacity = ghost ? 0.07 + (Math.floor(now * 12) % 3 === 0 ? 0.16 : 0) : 1;
    this.ball.children[0].visible = !ghost;
    this.ball.castShadow = !ghost;
    this.marker.visible = !ghost;
    this.marker.position.x = b.x;
    this.marker.scale.setScalar(THREE.MathUtils.clamp(1 - b.y / 12, 0.35, 1) * 1.4);

    // Bidikan penonton: hijau kalau boleh melempar di situ, merah kalau belum.
    const sp = s.spec;
    this.reticle.visible = sp.active && s.phase !== "over";
    if (this.reticle.visible) {
      const side = sp.x < 0 ? 0 : 1;
      const ok = sp.ammo >= 1 && side !== sp.lastSide && Math.abs(sp.x) >= 0.9;
      this.reticle.position.set(sp.x, 0.05, 0);
      this.reticle.children[3].position.y = 3.4 + Math.sin(now * 6) * 0.15;
      this.reticleMat.color.setHex(ok ? 0x7dff6a : 0xff4f6d);
    }

    // Benda lemparan: melayang dari tribun selama peringatan, lalu jatuh atau tergeletak.
    for (let k = 0; k < this.hazardViews.length; k++) {
      const v = this.hazardViews[k];
      const h = s.hazards[k];
      v.peel.visible = v.sandal.visible = v.warn.visible = false;
      if (!h) continue;
      const item = h.kind === "peel" ? v.peel : v.sandal;
      item.visible = true;
      const restY = h.kind === "peel" ? 0.07 : h.y;
      if (h.warn > 0) {
        const u = 1 - h.warn / 48; // 0 = baru dilempar, 1 = sampai
        const arc = Math.sin(u * Math.PI) * 2.6;
        item.position.set(h.x, THREE.MathUtils.lerp(1.2, restY, u) + arc, THREE.MathUtils.lerp(-4.7, 0.25, u));
        item.rotation.set(u * 9, u * 5, u * 7);
      } else {
        item.position.set(h.x, restY, 0.25);
        if (h.kind === "peel") item.rotation.set(0, 0.6, 0);
        else item.rotation.set(0, 0, now * 14);
      }
      // Tanda merah di lantai: berkedip selama peringatan dan selama sandal masih di udara.
      const danger = h.warn > 0 || h.kind === "sandal";
      v.warn.visible = danger && Math.floor(now * 10) % 2 === 0;
      v.warn.position.set(h.x, 0.04, 0);
    }

    this.fx.update(s);
    this.scenery.update(now, excite);

    // Kamera sedikit mengikuti bola, plus getaran saat pukulan keras.
    // Saat ulti, kamera menyorot dekat ke pemakainya.
    // Kamera membingkai kedua pemain dan bola: makin rapat aksinya, makin dekat,
    // supaya karakter tampil besar. Lantai selalu tetap di tepi bawah layar.
    let minX = b.x;
    let maxX = b.x;
    let top = b.y;
    for (const p of s.players) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      top = Math.max(top, p.y + 2);
    }
    minX -= 2.3;
    maxX += 2.3;
    top += 1.3;
    let tz = THREE.MathUtils.clamp(Math.max((maxX - minX) / VIEW_W, (top + 1.1) / VIEW_H), 0.58, 1);
    const slack = ((1 - tz) * VIEW_W) / 2;
    let tx = THREE.MathUtils.clamp((minX + maxX) / 2, -slack, slack);
    let ty = (VIEW_H * tz) / 2 - 1.1 * tz;
    let follow = 0.07;
    if (this.focus >= 0) {
      const fp = s.players[this.focus];
      tx = fp.x * 0.8;
      ty = fp.y + 1.6;
      tz = 0.5;
      follow = 0.22;
    } else if (this.camZoom < 0.98) {
      follow = 0.16; // kembali cepat setelah sorotan selesai
    }
    this.camX += (tx - this.camX) * follow;
    this.camY += (ty - this.camY) * follow;
    this.camZoom += (tz - this.camZoom) * follow;
    this.shake *= 0.86;
    // Getaran pakai waktu nyata supaya tetap terasa saat hitstop.
    const sx = Math.sin(now * 97) * this.shake * this.shakeScale;
    const sy = Math.cos(now * 113) * this.shake * this.shakeScale;
    this.camera.position.set(this.camX + sx, this.camY + 1.1 * this.camZoom + sy, this.camDist * this.camZoom);
    this.camera.lookAt(this.camX + sx, this.camY + sy, 0);

    this.renderer.render(this.scene, this.camera);
  }
}
