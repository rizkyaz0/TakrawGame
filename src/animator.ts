import type { Player, SpecialKind } from "./sim";

// Animator: menghitung pose dari state simulasi, tanpa tahu bentuk badannya.
// Dipisah dari bentuk karakter supaya rig lain bisa memakai gerakan yang sama.
//
// Aturan takraw: bola tidak boleh disentuh tangan atau lengan. Di semua pose, lengan
// hanya dipakai untuk keseimbangan dan tidak pernah diarahkan ke bola.
//
// Konvensi sudut: karakter menghadap "depan"; sudut positif = anggota badan
// mengayun ke depan. lean positif = badan condong ke belakang.

export type AnimKind = "smash" | "special" | "touch" | "guard";
export const ANIM_FRAMES: Record<AnimKind, number> = { smash: 20, special: 30, touch: 12, guard: 20 };
export const STRIKE_U = 0.4; // titik di animasi tendangan saat kaki mengenai bola

export const POSE_KEYS = [
  "hipL", "hipR", "kneeL", "kneeR", "shL", "shR", "elL", "elR", "lean", "twist", "bob",
] as const;
export type PoseKey = (typeof POSE_KEYS)[number];
export type Pose = Record<PoseKey, number>;

const zeroPose = (): Pose => ({
  hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: 0, elR: 0, lean: 0, twist: 0, bob: 0,
});

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (t: number) => clamp(t, 0, 1);
const bell = (t: number) => Math.sin(Math.PI * clamp01(t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// Ayunan tendangan: ancang-ancang ke belakang, sabet ke arah bola, lalu turun.
// Tepat di STRIKE_U kaki berada di sudut "peak", yaitu mengarah ke bola.
function kickHip(t: number, peak: number): number {
  if (t < 0.22) return lerp(0, -0.9, ease(t / 0.22));
  if (t < STRIKE_U) return lerp(-0.9, peak, (t - 0.22) / (STRIKE_U - 0.22));
  if (t < 0.52) return lerp(peak, peak + 0.3, (t - STRIKE_U) / (0.52 - STRIKE_U));
  return lerp(peak + 0.3, 0, ease((t - 0.52) / 0.48));
}
function kickKnee(t: number): number {
  if (t < 0.22) return lerp(-0.2, -1.7, ease(t / 0.22));
  if (t < STRIKE_U) return lerp(-1.7, 0, (t - 0.22) / (STRIKE_U - 0.22));
  return lerp(0, -0.25, ease((t - STRIKE_U) / (1 - STRIKE_U)));
}

type Part = "foot" | "knee" | "head";

interface Anim {
  kind: AnimKind;
  start: number;
  aim: number | null; // sudut kaki menuju bola saat kontak; null = belum kena apa-apa
  reach: number; // seberapa jauh kaki harus memanjang supaya sampai ke bola
  part: Part; // bagian badan yang dipakai untuk sentuhan biasa
  roll: boolean; // roll spike: smash sambil salto di udara
  dur: number; // lama animasi dalam frame
}

const ROLL_FRAMES = 24;
// Sudut putar badan selama roll spike. Di momen kontak badan sedang terbalik.
const rollAngle = (u: number) => Math.PI * 2 * ease(u / 0.86);

export interface PoseOut {
  pose: Pose;
  df: number; // frame simulasi yang berlalu sejak update terakhir
  spinY: number; // putaran penuh badan (Tendangan Api)
  flipZ: number; // salto ke belakang (roll spike)
  lift: number; // badan terangkat sedikit
  nod: number; // kepala mendongak (sundulan)
  look: number; // arah pandang kepala ke bola
  face: number; // 0 = agak menghadap kamera, 1 = lurus menghadap lawan
  legStretch: number; // kaki kanan memanjang saat kontak
  glow: number;
  squash: number;
  jitterX: number;
}

export class Animator {
  private pose = zeroPose();
  private vel = zeroPose();
  private squash = 0;
  private squashVel = 0;
  private wasGrounded = true;
  private runPhase = 0;
  private lastFrame = -1;
  private anim: Anim | null = null;
  private look = 0;

  // hipHeight dan legLength dalam satuan dunia, sesuai rig yang dipakai.
  // maxReach: batas kaki memanjang; karakter berkaki karet boleh jauh lebih besar.
  constructor(
    private hipHeight: number,
    private legLength: number,
    private maxReach = 1.9,
  ) {}

  // Ayunan dimulai (tombol ditekan), belum tentu kena bola.
  // roll = true untuk smash di udara dengan bola di atas kepala (roll spike).
  play(kind: AnimKind, frame: number, roll = false): void {
    if (kind === "touch" && this.anim && this.anim.kind !== "touch") return;
    const dur = roll ? ROLL_FRAMES : ANIM_FRAMES[kind];
    this.anim = { kind, start: frame, aim: null, reach: 1, part: "foot", roll, dur };
  }

  // Bola benar-benar kena: arahkan kaki ke titik kontak dan lompat ke momen sabetan,
  // supaya saat hitstop membekukan layar, kaki tepat menempel di bola.
  strike(kind: AnimKind, frame: number, p: Player, bx: number, by: number): void {
    const dx = (bx - p.x) * p.facing;
    const dy = by - (p.y + this.hipHeight);
    const aim = clamp(Math.atan2(dx, -dy), -1.3, 2.7);
    const reach = clamp((Math.hypot(dx, dy) - 0.2) / this.legLength, 1, this.maxReach);
    let part: Part = "foot";
    let lead = STRIKE_U;
    if (kind === "touch") {
      if (this.anim && this.anim.kind !== "touch") return;
      // Seperti takraw sungguhan: bola tinggi disundul, sedang pakai lutut, rendah pakai kaki.
      const rel = by - p.y;
      part = rel > 1.75 ? "head" : rel > 1.05 ? "knee" : "foot";
      lead = 0.35;
    } else if (kind === "guard") {
      // Terima bola: sama seperti sentuhan, tanpa tangan. Tinggi disundul, sedang
      // ditahan dada/paha, rendah ditahan kaki.
      const rel = by - p.y;
      part = rel > 1.75 ? "head" : rel > 1.05 ? "knee" : "foot";
      lead = 0.4;
    }
    // Kalau ayunannya sudah berjalan sebagai roll spike, tetap roll spike.
    const running = this.anim && this.anim.kind === kind ? this.anim : null;
    const roll = running ? running.roll : false;
    const dur = running ? running.dur : ANIM_FRAMES[kind];
    this.anim = { kind, start: frame - lead * dur, aim, reach, part, roll, dur };
  }

  compute(
    p: Player,
    frame: number,
    ball: { x: number; y: number },
    charging: boolean,
    special: SpecialKind,
  ): PoseOut {
    const df = this.lastFrame < 0 || frame < this.lastFrame ? 1 : Math.min(4, frame - this.lastFrame);
    this.lastFrame = frame;

    // Pose dasar: kuda-kuda siaga dengan tangan terangkat.
    const t: Pose = {
      hipL: 0.28, hipR: -0.22, kneeL: -0.4, kneeR: -0.32,
      shL: 0.9, shR: 0.5, elL: 1.5, elR: 1.7, lean: -0.1, twist: 0, bob: 0,
    };
    const fwd = Math.sign(p.vx * p.facing) || 1;
    const speed = Math.abs(p.vx);

    if (p.dashTimer > 0) {
      t.lean = -0.5 * fwd;
      t.hipR = -0.8 * fwd;
      t.hipL = 0.7 * fwd;
      t.kneeL = -0.9;
      t.kneeR = -0.3;
      t.shL = t.shR = -1.3 * fwd;
      t.elL = t.elR = 0.15;
    } else if (!p.grounded) {
      if (p.vy > 1) {
        t.hipR = 1.1;
        t.kneeR = -1.6;
        t.hipL = -0.35;
        t.kneeL = -0.6;
        t.shR = 1.1;
        t.shL = -0.9;
        t.elL = t.elR = 0.25;
        t.lean = -0.1;
      } else {
        t.hipR = 0.45;
        t.hipL = -0.3;
        t.kneeL = -0.7;
        t.kneeR = -0.4;
        t.shR = 1.2;
        t.shL = -1.2;
        t.elL = t.elR = 0.35;
        t.lean = 0.08;
      }
    } else if (speed > 0.8) {
      this.runPhase += speed * 0.062 * df * fwd;
      const a = Math.sin(this.runPhase);
      const c = Math.cos(this.runPhase);
      t.hipR = a * 1.0;
      t.hipL = -a * 1.0;
      t.kneeR = -0.35 - 0.95 * Math.max(0, c);
      t.kneeL = -0.35 - 0.95 * Math.max(0, -c);
      t.shR = -a * 1.1;
      t.shL = a * 1.1;
      t.elL = t.elR = 1.3;
      t.lean = -0.24 * fwd;
      t.twist = a * 0.4;
      t.bob = Math.abs(c) * 0.07 - 0.03;
    } else {
      // Diam: memantul ringan di ujung kaki, seperti petarung menunggu bola.
      const b = Math.sin(frame * 0.2);
      t.bob = b * 0.03 - 0.02;
      t.kneeL -= b * 0.08;
      t.kneeR -= b * 0.08;
      t.shL += b * 0.1;
      t.shR -= b * 0.1;
    }

    // Melar/gepeng: gepeng saat mendarat, melar saat lepas landas dan melaju vertikal.
    let squashKick = 0;
    if (p.grounded && !this.wasGrounded) squashKick = -0.16;
    if (!p.grounded && this.wasGrounded && p.vy > 0) squashKick = 0.14;
    this.wasGrounded = p.grounded;
    const squashTarget = p.grounded ? 0 : clamp(Math.abs(p.vy) * 0.007, 0, 0.12);

    // Kepala selalu menatap bola.
    const hx = Math.abs(ball.x - p.x) + 0.8;
    const hy = ball.y - (p.y + 1.7);
    const lookTarget = clamp(Math.atan2(hy, hx), -0.45, 0.8);

    for (let n = 0; n < df; n++) {
      for (const key of POSE_KEYS) {
        this.vel[key] = (this.vel[key] + (t[key] - this.pose[key]) * 0.2) * 0.66;
        this.pose[key] += this.vel[key];
      }
      this.squashVel = (this.squashVel + (squashTarget - this.squash) * 0.25 + (n === 0 ? squashKick : 0)) * 0.72;
      this.squash += this.squashVel;
      this.look += (lookTarget - this.look) * 0.22;
    }

    // Animasi serangan menimpa pose dasar selama durasinya.
    const o: Pose = { ...this.pose };
    let spinY = 0;
    let flipZ = 0;
    let glow = 0;
    let legStretch = 1;
    let lift = 0;
    let nod = 0;
    let face = 0;
    if (this.anim) {
      const an = this.anim;
      const u = (frame - an.start) / an.dur;
      if (u >= 1 || u < 0) {
        this.anim = null;
      } else if (an.kind === "guard") {
        // Terima bola. Takraw melarang tangan dan lengan, jadi kedua lengan ditarik ke
        // belakang badan; bola ditahan dengan kepala, dada/paha, atau kaki.
        const w = u < 0.15 ? u / 0.15 : u > 0.75 ? (1 - u) / 0.25 : 1;
        face = w;
        o.shL = lerp(o.shL, -0.95, w);
        o.shR = lerp(o.shR, -0.75, w);
        o.elL = lerp(o.elL, 0.25, w);
        o.elR = lerp(o.elR, 0.25, w);
        if (an.aim === null) {
          // Bersiap: lutut ditekuk, dada dibusungkan, satu kaki terangkat sedikit.
          o.kneeL = lerp(o.kneeL, -0.75, w);
          o.hipL = lerp(o.hipL, 0.45, w);
          o.hipR = lerp(o.hipR, 0.7, w);
          o.kneeR = lerp(o.kneeR, -1.1, w);
          o.lean = lerp(o.lean, 0.14, w);
          o.bob = lerp(o.bob, -0.05, w);
        } else if (an.part === "head") {
          // Sundulan menahan: badan naik, kepala mendongak.
          lift = 0.12 * w;
          nod = 0.5 * w;
          o.lean = lerp(o.lean, 0.1, w);
          o.kneeL = lerp(o.kneeL, -0.2, w);
          o.kneeR = lerp(o.kneeR, -0.2, w);
        } else if (an.part === "knee") {
          // Dada dan paha: badan condong ke belakang, paha naik menyambut bola.
          o.hipR = lerp(o.hipR, clamp(an.aim, 0.9, 1.9), w);
          o.kneeR = lerp(o.kneeR, -1.8, w);
          o.lean = lerp(o.lean, 0.32, w);
          o.kneeL = lerp(o.kneeL, -0.35, w);
        } else {
          // Kaki bagian dalam: kaki diayun rendah ke arah bola.
          o.hipR = lerp(o.hipR, an.aim, w);
          o.kneeR = lerp(o.kneeR, -0.35, w);
          o.lean = lerp(o.lean, 0.12, w);
          o.kneeL = lerp(o.kneeL, -0.5, w);
          legStretch = 1 + (Math.min(an.reach, this.maxReach * 0.6) - 1) * w;
        }
      } else if (an.kind === "touch") {
        const w = bell(u);
        const aim = an.aim ?? 1.2;
        face = w * 0.6;
        if (an.part === "head") {
          // Sundulan: badan naik, kepala mendongak menyambut bola.
          lift = 0.14 * w;
          nod = 0.45 * w;
          o.lean = lerp(o.lean, -0.12, w);
          o.shL = lerp(o.shL, -0.9, w);
          o.shR = lerp(o.shR, -0.7, w);
          o.elL = lerp(o.elL, 0.4, w);
          o.elR = lerp(o.elR, 0.4, w);
          o.kneeL = lerp(o.kneeL, -0.1, w);
          o.kneeR = lerp(o.kneeR, -0.1, w);
        } else if (an.part === "knee") {
          // Lutut: paha mengarah ke bola, betis terlipat.
          o.hipR = lerp(o.hipR, clamp(aim, 0.7, 2.0), w);
          o.kneeR = lerp(o.kneeR, -1.75, w);
          o.lean = lerp(o.lean, 0.12, w);
          o.shL = lerp(o.shL, 0.9, w);
          o.shR = lerp(o.shR, -0.8, w);
        } else {
          // Kaki: sontekan ke arah bola.
          o.hipR = lerp(o.hipR, aim, w);
          o.kneeR = lerp(o.kneeR, -0.2, w);
          o.lean = lerp(o.lean, 0.15, w);
          o.shL = lerp(o.shL, 1.0, w);
          o.shR = lerp(o.shR, -0.9, w);
          legStretch = 1 + (Math.min(an.reach, this.maxReach * 0.72) - 1) * w;
        }
      } else {
        const w = bell(u);
        face = w;
        // Kaki memanjang di sekitar momen kontak supaya telapak sampai ke bola.
        const near = clamp01(1 - Math.abs(u - STRIKE_U) / 0.16);
        legStretch = 1 + (Math.max(an.reach, 1.25) - 1) * near;
        if (an.kind === "smash" && an.roll) {
          // Roll spike: badan berputar ke belakang di udara, lutut ditekuk rapat, lalu kaki
          // penyabet melecut ke bola tepat saat badan terbalik, dan mendarat tegak.
          flipZ = rollAngle(u);
          const strikeFlip = rollAngle(STRIKE_U);
          // Sudut kaki dihitung terhadap badan yang sedang terbalik supaya di dunia tetap ke bola.
          let local = (an.aim ?? 2.4) - strikeFlip;
          while (local < -Math.PI) local += Math.PI * 2;
          const whip = clamp01(1 - Math.abs(u - STRIKE_U) / 0.2);
          const tuck = bell(u) * (1 - whip);
          o.hipR = lerp(lerp(o.hipR, 1.5, tuck), local, whip);
          o.kneeR = lerp(lerp(o.kneeR, -2.0, tuck), 0, whip);
          o.hipL = lerp(o.hipL, 1.6, w);
          o.kneeL = lerp(o.kneeL, -2.0, w);
          o.lean = lerp(o.lean, -0.25, w);
          o.shL = lerp(o.shL, -0.9, w);
          o.shR = lerp(o.shR, 0.9, w);
          o.elL = lerp(o.elL, 0.6, w);
          o.elR = lerp(o.elR, 0.6, w);
          lift = 0.15 * w;
          face = 1;
        } else if (an.kind === "smash" || special === "meteor") {
          o.hipR = kickHip(u, an.aim ?? 2.1);
          o.kneeR = kickKnee(u);
          o.hipL = lerp(o.hipL, -0.3, w);
          o.kneeL = lerp(o.kneeL, -0.45, w);
          o.lean = lerp(o.lean, 0.26, w);
          o.twist = lerp(o.twist, -0.6, w);
          o.shR = lerp(o.shR, -1.7, w);
          o.shL = lerp(o.shL, 1.15, w);
          o.elL = lerp(o.elL, 0.3, w);
          o.elR = lerp(o.elR, 0.3, w);
          if (an.kind === "special") {
            lift = 0.18 * w;
            glow = w;
          }
        } else if (special === "fire" || special === "ghost") {
          // Putaran penuh sambil tetap tegak, lalu sabetan tinggi.
          spinY = -Math.PI * 2 * ease(u / STRIKE_U);
          lift = 0.12 * w;
          o.hipR = kickHip(u, an.aim ?? 2.3);
          o.kneeR = kickKnee(u);
          o.hipL = lerp(o.hipL, -0.35, w);
          o.kneeL = lerp(o.kneeL, -0.7, w);
          o.lean = lerp(o.lean, 0.24, w);
          o.shR = lerp(o.shR, -2.0, w);
          o.shL = lerp(o.shL, 1.25, w);
          o.elL = lerp(o.elL, 0.2, w);
          o.elR = lerp(o.elR, 0.2, w);
          glow = w;
        } else {
          // Tendangan gunting: kaki kiri naik memancing, lalu kaki kanan menyabet;
          // badan tetap tegak sepanjang gerakan.
          const feint = bell(u / 0.5);
          lift = 0.3 * w;
          o.hipL = lerp(o.hipL, 1.6, feint);
          o.kneeL = lerp(o.kneeL, -1.3, feint);
          o.hipR = kickHip(u, an.aim ?? 2.0);
          o.kneeR = kickKnee(u);
          o.lean = lerp(o.lean, 0.2, w);
          o.twist = lerp(o.twist, Math.sin(u * Math.PI * 2) * 0.8, w);
          o.shL = lerp(o.shL, 1.25, w);
          o.shR = lerp(o.shR, -1.5, w);
          o.elL = lerp(o.elL, 0.3, w);
          o.elR = lerp(o.elR, 0.3, w);
          glow = w;
        }
      }
    }

    // Mengumpulkan tenaga saat layar membeku sebelum ulti: jongkok, tangan mengepal, bergetar.
    let jitterX = 0;
    if (charging) {
      const now = performance.now();
      glow = 0.6 + Math.sin(now * 0.03) * 0.4;
      // Pose jongkok hanya saat diam di tanah; kalau sedang bergerak atau melompat sambil
      // menunggu bola, karakter tetap bergerak biasa dan hanya badannya yang menyala.
      if (p.grounded && speed < 0.8 && !this.anim) {
        jitterX = Math.sin(now * 0.09) * 0.025;
        o.kneeL = -1.0;
        o.kneeR = -0.95;
        o.hipL = 0.75;
        o.hipR = 0.35;
        o.lean = -0.2;
        o.shL = -0.5;
        o.shR = -0.3;
        o.elL = 0.9;
        o.elR = 0.9;
        o.bob = -0.02;
      }
    }

    o.kneeL = Math.min(0.15, o.kneeL);
    o.kneeR = Math.min(0.15, o.kneeR);
    o.elL = Math.max(0, o.elL);
    o.elR = Math.max(0, o.elR);

    return {
      pose: o,
      df,
      spinY,
      flipZ,
      lift,
      nod,
      look: this.look,
      face,
      legStretch,
      glow,
      squash: clamp(this.squash, -0.3, 0.3),
      jitterX,
    };
  }
}
