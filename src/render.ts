import * as THREE from "three";
import type { AnimKind } from "./animator";
import { FoodCharacter } from "./foodchar";
import { Fx } from "./fx";
import { Scenery } from "./scenery";
import {
  BALL_R,
  BODY_Y,
  CHARS,
  COURT_HALF,
  GUARD_R,
  HEAT_MAX,
  SMASH_R,
  SPECIAL_R,
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
}

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
  private camDist = 20;
  private camX = 0;
  private camY = LOOK_Y;
  private camZoom = 1;
  private shake = 0;
  private focus = -1; // pemain yang sedang disorot saat layar membeku sebelum ulti
  // Petunjuk timing per pemain: "smash" (emas), "guard" (biru), atau null.
  cues: Array<"smash" | "guard" | null> = [null, null];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.prepend(this.renderer.domElement);
    styleUniforms.uPx.value = this.renderer.getPixelRatio();

    this.scene.add(new THREE.HemisphereLight(0xfff6e0, 0x8a7fa8, 1.5));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.set(-7, 15, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.scenery = new Scenery(this.scene);
    this.fx = new Fx(this.scene);

    for (let i = 0; i < 2; i++) {
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
      this.players.push({ cue, char: null, ring });
    }

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

    window.addEventListener("resize", () => this.resize());
    this.resize();
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

  private playAnim(i: number, kind: AnimKind, f: number): void {
    this.players[i].char?.play(kind, f);
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
        this.fx.burst(f, e.x, e.y, e.perfect ? 0xffffff : 0x7fd4ff, e.perfect ? 1.3 : 0.8);
        if (e.perfect) this.fx.burst(f, e.x, e.y, 0x7fd4ff, 0.8);
        break;
      case "whiff":
        this.playAnim(e.player, "smash", f);
        break;
      case "special":
        this.playAnim(e.player, "special", f);
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

    for (let i = 0; i < 2; i++) {
      const p = s.players[i];
      const v = this.players[i];

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
      const mood = !decided ? null : s.server === i ? "win" : "lose";
      v.char.update(p, s.frame, s.ball, this.focus === i, mood);

      const c = CHARS[s.chars[i]];
      const special = p.specialTimer > 0;
      const cueKind = this.cues[i];
      v.cue.visible = cueKind !== null;
      v.cue.position.set(p.x, p.y + BODY_Y, 0.05);
      (v.cue.material as THREE.MeshBasicMaterial).color.setHex(cueKind === "guard" ? 0x7fd4ff : 0xffd23f);
      v.cue.scale.setScalar(1 + Math.sin(now * 40) * 0.04);

      const guarding = p.guardTimer > 0;
      v.ring.visible = special || guarding || p.smashTimer > 0;
      v.ring.position.set(p.x, p.y + BODY_Y, 0);
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

    this.fx.update(s);
    this.scenery.update(now, excite);

    // Kamera sedikit mengikuti bola, plus getaran saat pukulan keras.
    // Saat ulti, kamera menyorot dekat ke pemakainya.
    // Kamera membingkai kedua pemain dan bola: makin rapat aksinya, makin dekat,
    // supaya karakter tampil besar. Lantai selalu tetap di tepi bawah layar.
    const p0 = s.players[0];
    const p1 = s.players[1];
    const minX = Math.min(p0.x, p1.x, b.x) - 2.3;
    const maxX = Math.max(p0.x, p1.x, b.x) + 2.3;
    const top = Math.max(b.y, p0.y + 2, p1.y + 2) + 1.3;
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
    const sx = Math.sin(now * 97) * this.shake;
    const sy = Math.cos(now * 113) * this.shake;
    this.camera.position.set(this.camX + sx, this.camY + 1.1 * this.camZoom + sy, this.camDist * this.camZoom);
    this.camera.lookAt(this.camX + sx, this.camY + sy, 0);

    this.renderer.render(this.scene, this.camera);
  }
}
