import * as THREE from "three";
import { BALL_R, type GameState } from "./sim";
import { INK } from "./style";

// Efek gaya komik: ledakan bintang saat bola kena, jejak pita di belakang bola,
// dan kepulan debu. Semua waktu dihitung dari frame simulasi, jadi ikut membeku
// saat hitstop.

const TRAIL_POINTS = 14;
const FX_Z = 0.7;

interface Burst {
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  born: number;
  life: number;
  size: number;
  spin: number;
}

interface Dust {
  mesh: THREE.Mesh;
  born: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

function starShape(spikes: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < spikes * 2; i++) {
    // Panjang duri dibuat tidak rata supaya terasa digambar tangan.
    const r = i % 2 === 0 ? 1 - ((i * 37) % 5) * 0.06 : inner;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return shape;
}

export class Fx {
  private bursts: Burst[] = [];
  private dusts: Dust[] = [];
  private nextBurst = 0;
  private nextDust = 0;

  private hist: Array<{ x: number; y: number }> = [];
  private lastFrame = -1;
  private lastSpark = -1;
  private trailPos = new Float32Array(TRAIL_POINTS * 2 * 3);
  private trailGeo = new THREE.BufferGeometry();
  private trailMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private trail: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const starGeo = new THREE.ShapeGeometry(starShape(11, 0.42));
    const coreGeo = new THREE.CircleGeometry(0.34, 20);
    const inkMat = new THREE.MeshBasicMaterial({ color: INK, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const group = new THREE.Group();
      const fill = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
      const back = new THREE.Mesh(starGeo, inkMat);
      back.scale.setScalar(1.16);
      const front = new THREE.Mesh(starGeo, fill);
      front.position.z = 0.01;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.z = 0.02;
      group.add(back, front, core);
      group.visible = false;
      group.renderOrder = 5;
      scene.add(group);
      this.bursts.push({ group, fill, born: -999, life: 1, size: 1, spin: i * 0.7 });
    }

    const dustGeo = new THREE.SphereGeometry(1, 10, 8);
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    const dustInk = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(dustGeo, dustMat);
      const hull = new THREE.Mesh(dustGeo, dustInk);
      hull.scale.setScalar(1.18);
      mesh.add(hull);
      mesh.visible = false;
      scene.add(mesh);
      this.dusts.push({ mesh, born: -999, life: 1, x: 0, y: 0, vx: 0, vy: 0, size: 0.1 });
    }

    const index: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setIndex(index);
    this.trail = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 2;
    scene.add(this.trail);
  }

  burst(frame: number, x: number, y: number, color: number, size: number): void {
    const b = this.bursts[this.nextBurst];
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    b.born = frame;
    b.life = 7 + size * 3;
    b.size = size;
    b.fill.color.setHex(color);
    b.group.position.set(x, y, FX_Z);
  }

  dust(frame: number, x: number, y: number, count: number, dirX = 0): void {
    for (let i = 0; i < count; i++) {
      const d = this.dusts[this.nextDust];
      this.nextDust = (this.nextDust + 1) % this.dusts.length;
      const spread = (i / Math.max(1, count - 1) - 0.5) * 2;
      d.born = frame;
      d.life = 16 + ((i * 7) % 6);
      d.x = x + spread * 0.25;
      d.y = y + 0.1;
      d.vx = spread * 0.05 - dirX * 0.06;
      d.vy = 0.02 + ((i * 13) % 5) * 0.008;
      d.size = 0.11 + ((i * 5) % 4) * 0.03;
    }
  }

  update(s: GameState): void {
    const frame = s.frame;

    for (const b of this.bursts) {
      const age = frame - b.born;
      if (age < 0 || age >= b.life) {
        b.group.visible = false;
        continue;
      }
      const u = age / b.life;
      const grow = 1 - Math.pow(1 - Math.min(1, u * 2.8), 3);
      const shrink = u > 0.6 ? 1 - (u - 0.6) / 0.4 : 1;
      b.group.visible = true;
      b.group.scale.setScalar(Math.max(0.001, b.size * (0.3 + grow) * shrink));
      // Rotasi melompat tiap dua frame: efek "boil" gambar tangan.
      b.group.rotation.z = b.spin + Math.floor(age / 2) * 0.35;
    }

    for (const d of this.dusts) {
      const age = frame - d.born;
      if (age < 0 || age >= d.life) {
        d.mesh.visible = false;
        continue;
      }
      const u = age / d.life;
      d.mesh.visible = true;
      d.mesh.position.set(d.x + d.vx * age, d.y + d.vy * age, 0.3);
      d.mesh.scale.setScalar(d.size * (0.6 + u * 0.9) * (1 - u * u));
    }

    // Bola ulti meninggalkan percikan di sepanjang lintasannya.
    const b = s.ball;
    if (s.phase === "play" && s.hitstop === 0 && frame !== this.lastSpark) {
      this.lastSpark = frame;
      if (b.rise > 0) {
        if (frame % 3 === 0) this.burst(frame, b.x, b.y, 0xb6f07a, 0.32);
      } else if (b.power > 0) {
        if (frame % 2 === 0) this.burst(frame, b.x, b.y, frame % 4 === 0 ? 0xff7a1a : 0xffd23f, 0.42);
      } else if (b.curveSide >= 0) {
        if (frame % 3 === 0) this.burst(frame, b.x, b.y, 0x4dffd2, 0.3);
      } else if (b.wave > 0) {
        if (frame % 3 === 0) this.burst(frame, b.x, b.y, 0xc59bff, 0.3);
      }
    }

    this.updateTrail(s);
  }

  private updateTrail(s: GameState): void {
    const b = s.ball;
    if (s.frame !== this.lastFrame) {
      const head = this.hist[0];
      if (s.frame < this.lastFrame || (head && Math.hypot(head.x - b.x, head.y - b.y) > 3)) {
        this.hist.length = 0; // bola dipindah (servis baru), jangan tarik garis
      }
      this.lastFrame = s.frame;
      this.hist.unshift({ x: b.x, y: b.y });
      if (this.hist.length > TRAIL_POINTS) this.hist.length = TRAIL_POINTS;
    }

    const speed = Math.hypot(b.vx, b.vy);
    const strong = b.power > 0 || b.curveSide >= 0 || b.wave > 0 || b.rise > 0;
    const amount = strong ? 1 : Math.min(1, Math.max(0, (speed - 9) / 8));
    const hot = Math.min(1, s.heat / 25);
    const n = this.hist.length;
    if (amount <= 0.01 || n < 3 || s.phase !== "play" || b.ghost > 0) {
      this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    this.trailMat.color.setHex(
      b.rise > 0 ? 0xb6f07a : b.power > 0 ? 0xff7a1a : b.curveSide >= 0 ? 0x4dffd2 : b.wave > 0 ? 0xc59bff : hot > 0.5 ? 0xff9a3d : hot > 0.2 ? 0xffe08a : 0xffffff,
    );
    this.trailMat.opacity = strong ? 0.95 : 0.35 + amount * 0.5;

    const width = BALL_R * (strong ? 1.25 : 0.95);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = this.hist[Math.min(i, n - 1)];
      const q = this.hist[Math.min(i + 1, n - 1)];
      const prev = this.hist[Math.max(0, Math.min(i, n - 1) - 1)];
      let dx = prev.x - q.x;
      let dy = prev.y - q.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = width * (1 - i / (TRAIL_POINTS - 1));
      const k = i * 6;
      this.trailPos[k] = p.x - dy * w;
      this.trailPos[k + 1] = p.y + dx * w;
      this.trailPos[k + 2] = -0.05;
      this.trailPos[k + 3] = p.x + dy * w;
      this.trailPos[k + 4] = p.y - dx * w;
      this.trailPos[k + 5] = -0.05;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
  }
}
