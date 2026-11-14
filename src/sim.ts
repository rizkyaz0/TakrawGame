// Simulasi murni: tanpa DOM, tanpa Math.random, langkah tetap 60 Hz.
// State + input yang sama selalu menghasilkan hasil yang sama, supaya nanti
// bisa dipakai untuk rollback netcode.

export const FPS = 60;
export const DT = 1 / FPS;

export const COURT_HALF = 8;
export const CEILING = 13;
export const NET_H = 2.2;
export const NET_R = 0.08;
export const BALL_R = 0.3;
export const BODY_R = 0.75; // lingkaran badan pemain untuk sentuhan bola
export const BODY_Y = 0.8; // tinggi pusat lingkaran dari kaki
export const SMASH_R = 1.15;
export const WIN_SCORE = 7;
export const WIN_CAP = 10; // deuce: harus unggul 2, tapi skor 10 selalu menang

// Pemenang pertandingan untuk skor tertentu, atau -1 kalau belum ada.
export function gameWinner(a: number, b: number, win = WIN_SCORE, cap = WIN_CAP): number {
  if (a >= cap || (a >= win && a - b >= 2)) return 0;
  if (b >= cap || (b >= win && b - a >= 2)) return 1;
  return -1;
}

// Pemain bernomor genap di sisi kiri, ganjil di sisi kanan. Pemain 0 dan 1 adalah kapten
// tiap sisi; di mode tim, 2 dan 3 (lalu 4 dan 5) adalah teman setimnya.
export const sideOf = (i: number) => i & 1;
export const MAX_TEAM = 3;
// Posisi awal tiap anggota tim, diukur dari net.
const HOMES = [[4], [2.8, 6.0], [2.1, 4.4, 6.6]];
export function homeX(teamSize: number, i: number): number {
  const row = HOMES[Math.min(MAX_TEAM, Math.max(1, teamSize)) - 1];
  return row[Math.min(row.length - 1, i >> 1)] * (sideOf(i) === 0 ? -1 : 1);
}

// Bit 1 = P1 menang kalau dapat poin berikutnya, bit 2 = P2. Bisa dua-duanya (9-9).
export function matchPointMask(score: readonly [number, number], win = WIN_SCORE, cap = WIN_CAP): number {
  if (gameWinner(score[0], score[1], win, cap) >= 0) return 0; // pertandingan sudah selesai
  return (
    (gameWinner(score[0] + 1, score[1], win, cap) === 0 ? 1 : 0) |
    (gameWinner(score[0], score[1] + 1, win, cap) === 1 ? 2 : 0)
  );
}
export const MAX_TOUCHES = 3;

export const Btn = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  JUMP: 16,
  SMASH: 32,
  DASH: 64,
  SPECIAL: 128,
  GUARD: 256,
} as const;

export type SpecialKind = "fire" | "curve" | "zigzag" | "meteor" | "ghost";

export interface CharDef {
  name: string;
  color: number;
  moveSpeed: number;
  jumpV: number;
  smashSpeed: number;
  special: SpecialKind;
  specialName: string;
  charge?: number; // pengali kecepatan meter jurus terisi (bawaan 1); dipakai untuk menyeimbangkan
}

// Roster jajanan. Tampilan tiap karakter ada di foodchar.ts, urutannya harus sama.
export const CHARS: readonly CharDef[] = [
  {
    name: "Bang Sosis",
    color: 0xff5a3c,
    moveSpeed: 6.5,
    jumpV: 12.5,
    smashSpeed: 18.2,
    special: "fire",
    specialName: "Tendangan Bakar",
    charge: 0.8,
  },
  {
    name: "Mbak Lontong",
    color: 0x2f9e6b,
    moveSpeed: 7.0,
    jumpV: 13.2,
    smashSpeed: 15.9,
    special: "curve",
    specialName: "Bola Pelintir",
    charge: 1.07,
  },
  {
    name: "Pak Bakso",
    color: 0xc9743a,
    moveSpeed: 6.3,
    jumpV: 12.3,
    smashSpeed: 19.5,
    special: "fire",
    specialName: "Bom Bakso",
    charge: 0.8,
  },
  {
    name: "Mas Tahu",
    color: 0x4a7de0,
    moveSpeed: 6.6,
    jumpV: 12.8,
    smashSpeed: 16.2,
    special: "curve",
    specialName: "Tahu Dadakan",
    charge: 1.16,
  },
  {
    name: "Kak Pisang",
    color: 0xd9a016,
    moveSpeed: 7.2,
    jumpV: 12.6,
    smashSpeed: 15.9,
    special: "zigzag",
    specialName: "Kulit Licin",
    charge: 0.7,
  },
  {
    name: "Dek Lilin",
    color: 0x2fb4d6,
    moveSpeed: 7.0,
    jumpV: 13.6,
    smashSpeed: 16.3,
    special: "ghost",
    specialName: "Bola Mencair",
    charge: 1.7,
  },
  {
    name: "Bung Jagung",
    color: 0x9a66e0,
    moveSpeed: 6.3,
    jumpV: 13.0,
    smashSpeed: 16.7,
    special: "meteor",
    specialName: "Hujan Jagung",
    charge: 1.14,
  },
  {
    name: "Om Sate",
    color: 0xe07a2f,
    moveSpeed: 6.4,
    jumpV: 13.4,
    smashSpeed: 18.6,
    special: "fire",
    specialName: "Sate Membara",
    charge: 0.82,
  },
  {
    name: "Mbok Klepon",
    color: 0x58b84a,
    moveSpeed: 6.8,
    jumpV: 12.4,
    smashSpeed: 16.8,
    special: "ghost",
    specialName: "Gula Lumer",
    charge: 1.55,
  },
  {
    name: "Cak Kerupuk",
    color: 0xff8ad8,
    moveSpeed: 7.4,
    jumpV: 13.8,
    smashSpeed: 15.4,
    special: "zigzag",
    specialName: "Kerupuk Terbang",
    charge: 0.72,
  },
  {
    name: "Pakde Tempe",
    color: 0x3d9a8a,
    moveSpeed: 6.1,
    jumpV: 12.2,
    smashSpeed: 19.2,
    special: "meteor",
    specialName: "Tempe Mendoan",
    charge: 1.0,
  },
  {
    name: "Neng Cendol",
    color: 0x7fd4ff,
    moveSpeed: 6.9,
    jumpV: 13.1,
    smashSpeed: 16.4,
    special: "curve",
    specialName: "Santan Tumpah",
    charge: 1.1,
  },
];

// Panas reli: tiap smash yang masuk menaikkan kecepatan bola sampai servis berikutnya.
export const HEAT_MAX = 25;
const HEAT_STEP = 0.02;
// Smash sempurna: tombol ditekan sedikit SEBELUM bola masuk jangkauan, sehingga bola
// kena 2 sampai 5 frame setelah ditekan. Menekan saat bola sudah di dalam jangkauan
// (terlambat) atau jauh sebelumnya (terlalu cepat) hanya menghasilkan smash biasa.
export const PERFECT_FROM = 2;
export const PERFECT_TO = 5;
const PERFECT_BOOST = 1.18;
const METER_PERFECT = 26;

// Bertahan. Bola yang datang lebih kencang dari HARD_SPEED (atau bola jurus) akan
// terpental liar kalau cuma mengenai badan; tombol terima menjinakkannya.
export const GUARD_R = 1.25;
const HARD_SPEED = 14.5;
const GUARD_ACTIVE = 12;
const GUARD_RECOVER = 12;
export const GUARD_PERFECT = 4; // terima sempurna: bola kena dalam 4 frame pertama
const METER_RECEIVE = 10;
const METER_RECEIVE_PERFECT = 22;

export const METER_MAX = 100;
export const SPECIAL_COST = 50;
export const SPECIAL_R = 1.5;
// Jurus yang sudah diaktifkan "siaga" selama ini: begitu bola masuk jangkauan, pasti kena.
const SPECIAL_ARMED = 90;
const SPECIAL_RECOVER = 20;
const SPECIAL_WHIFF_RECOVER = 30; // jeda kalau jurus siaga sampai habis tanpa kena bola
export const SUPER_FREEZE = 18;
const FIRE_SPEED = 27;
const FIRE_FRAMES = 32; // cukup lama supaya masih "api" saat sampai ke lawan
const WAVE_FRAMES = 50; // cukup lama supaya gelombangnya masih hidup saat sampai ke lawan
const WAVE_OMEGA = 0.25;
const WAVE_AMP = 0.85;
const WAVE_SPEED = 14.5;
const WAVE_HEIGHT = 3.7;
const WAVE_LOW = 2.1;
const METEOR_RISE = 24;
const METEOR_TOP = 10.5;
const METEOR_SPEED = 30;
const GHOST_FRAMES = 42;
const GHOST_SPEED = 22;
const METER_TOUCH = 8;
const METER_SMASH = 14;
const METER_CONCEDE = 15;

const BALL_GRAVITY = 16;
const BALL_MAX_SPEED = 24;
const BALL_POWER_MAX_SPEED = 30;
const BALL_SUBSTEPS = 4;
const PLAYER_GRAVITY = 34;
const DASH_SPEED = 15;
const DASH_FRAMES = 8;
const DASH_COOLDOWN = 30;
const SMASH_ACTIVE = 10;
const SMASH_RECOVER = 14;
const HIT_COOLDOWN = 12;
// Smash tahan-bidik: begitu smash kena dan tombolnya masih ditahan, karakter dan bola mengapung
// sebentar sementara pemain memilih arah. Dilepas saat tombol dilepas (paling cepat AIM_MIN) atau otomatis.
export const AIM_MAX = 24;
export const AIM_MIN = 4;
const PLAYER_MIN_X = 0.5;
const PLAYER_MAX_X = COURT_HALF - 0.4;

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  grounded: boolean;
  jumpsLeft: number;
  dashTimer: number;
  dashCd: number;
  airDashUsed: boolean;
  smashTimer: number;
  smashRecover: number;
  aimTimer: number; // sisa frame mengapung membidik smash (0 = tidak membidik)
  aimPerfect: boolean; // hasil timing saat smash kena
  aimElapsed: number; // frame sejak tombol smash ditekan sampai kena
  aimX: number; // arah bidik yang sedang ditahan, -1..1
  aimY: number;
  specialTimer: number;
  guardTimer: number;
  stun: number; // sisa frame terhuyung setelah kewalahan: tidak bisa bergerak atau menyerang
  meter: number;
  hitCd: number;
  prev: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  power: number; // sisa frame "bola api": tanpa gravitasi, batas kecepatan naik
  curveSide: number; // pemilik Bola Pelintir yang belum menukik, -1 = tidak ada
  wave: number; // sisa frame zig-zag
  waveT: number;
  waveBase: number; // tinggi tengah gelombang zig-zag
  rise: number; // sisa frame naik sebelum jatuh lurus (Bola Blusukan)
  tx: number; // titik jatuh Bola Blusukan
  ghost: number; // sisa frame bola nyaris tak terlihat
}

function clearBallFx(b: Ball): void {
  b.power = 0;
  b.curveSide = -1;
  b.wave = 0;
  b.waveT = 0;
  b.waveBase = 0;
  b.rise = 0;
  b.tx = 0;
  b.ghost = 0;
}

export type Phase = "serve" | "play" | "point" | "over";

export type GameEvent =
  | { type: "touch"; player: number; x: number; y: number; weak: boolean }
  | { type: "guard"; player: number }
  // elapsed = jumlah frame antara tombol ditekan dan bola kena; dipakai mode latihan.
  | { type: "receive"; player: number; x: number; y: number; perfect: boolean; elapsed: number }
  | { type: "smash"; player: number; x: number; y: number; perfect: boolean; elapsed: number }
  | { type: "miss"; player: number; kind: "smash" | "guard" | "special" }
  | { type: "bounce" }
  | { type: "jump"; player: number }
  | { type: "dash"; player: number; dir: number }
  | { type: "land"; player: number }
  | { type: "whiff"; player: number }
  | { type: "aimStart"; player: number; x: number; y: number }
  | { type: "special"; player: number }
  | { type: "specialHit"; player: number; kind: SpecialKind; x: number; y: number }
  | { type: "curveDrop" }
  | { type: "score"; winner: number; fault: boolean }
  | { type: "over"; winner: number }
  // Penonton usil.
  | { type: "heckle"; kind: HazardKind; x: number; side: number }
  // Lemparan penonton ditolak: amunisi habis, sisi yang sama dua kali, atau terlalu dekat net.
  | { type: "heckleDenied"; reason: "ammo" | "side" | "net" }
  | { type: "slip"; player: number }
  | { type: "bonk"; target: "player" | "ball"; player: number; x: number; y: number };

// Benda yang dilempar penonton ke lapangan.
export type HazardKind = "peel" | "sandal";
export interface Hazard {
  kind: HazardKind;
  x: number;
  y: number;
  warn: number; // sisa frame peringatan sebelum bendanya benar-benar ada
  life: number; // sisa frame kulit pisang tergeletak di lantai
}

// Penonton yang dimainkan orang ketiga. Supaya adil: amunisi terbatas dan terisi pelan,
// dan dua lemparan berturut-turut tidak boleh ke sisi yang sama.
export interface Spectator {
  active: boolean;
  x: number; // posisi bidikan di lapangan
  ammo: number; // 0 sampai SPEC_MAX_AMMO, bisa pecahan saat sedang terisi
  lastSide: number; // sisi lemparan terakhir, -1 = belum pernah
  prev: number;
}
export const SPEC_MAX_AMMO = 2;
const SPEC_RECHARGE = 420; // frame untuk mengisi satu lemparan (7 detik)
const SPEC_SPEED = 10;
const SPEC_NET_GAP = 0.9;

const HECKLE_WARN = 48; // tanda peringatan muncul 0,8 detik sebelum benda sampai
const PEEL_LIFE = 420;
const PEEL_R = 0.5;
const SLIP_STUN = 30;
const SANDAL_FALL = 13;
const SANDAL_R = 0.55;
const SANDAL_STUN = 14;
const hz = (n: number) => Math.imul(n, 2654435761) >>> 0;

export interface GameState {
  frame: number;
  phase: Phase;
  timer: number;
  hitstop: number;
  chars: number[]; // karakter tiap pemain; panjangnya 2, 4, atau 6
  players: Player[];
  winScore: number; // poin untuk menang (harus unggul 2)
  winCap: number; // skor yang selalu menang
  ball: Ball;
  score: [number, number];
  server: number;
  rally: number; // jumlah pukulan dalam reli yang sedang berjalan
  heat: number; // panas reli, naik tiap smash yang masuk
  lastSide: number; // sisi yang terakhir menyentuh bola, -1 = belum ada
  touches: number;
  events: GameEvent[];
  rowdy: boolean; // penonton usil otomatis
  spec: Spectator; // penonton yang dimainkan orang
  heckleTimer: number; // frame sampai lemparan berikutnya
  hazards: Hazard[];
}

function makePlayer(i: number, teamSize: number): Player {
  const side = sideOf(i);
  return {
    x: homeX(teamSize, i),
    y: 0,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    grounded: true,
    jumpsLeft: 2,
    dashTimer: 0,
    dashCd: 0,
    airDashUsed: false,
    smashTimer: 0,
    smashRecover: 0,
    aimTimer: 0,
    aimPerfect: false,
    aimElapsed: 0,
    aimX: 0,
    aimY: 0,
    specialTimer: 0,
    guardTimer: 0,
    stun: 0,
    meter: 0,
    hitCd: 0,
    prev: 0,
  };
}

export function createState(chars: readonly number[] = [0, 1]): GameState {
  const s: GameState = {
    frame: 0,
    phase: "serve",
    timer: 0,
    hitstop: 0,
    chars: [...chars],
    players: chars.map((_, i) => makePlayer(i, chars.length >> 1)),
    winScore: WIN_SCORE,
    winCap: WIN_CAP,
    ball: { x: 0, y: 0, vx: 0, vy: 0, power: 0, curveSide: -1, wave: 0, waveT: 0, waveBase: 0, rise: 0, tx: 0, ghost: 0 },
    score: [0, 0],
    server: 0,
    rally: 0,
    heat: 0,
    lastSide: -1,
    touches: 0,
    events: [],
    rowdy: false,
    spec: { active: false, x: -3, ammo: 1, lastSide: -1, prev: 0 },
    heckleTimer: 300,
    hazards: [],
  };
  startServe(s);
  return s;
}

function startServe(s: GameState): void {
  const old = s.players;
  s.players = old.map((_, i) => makePlayer(i, old.length >> 1));
  for (let i = 0; i < old.length; i++) {
    s.players[i].prev = old[i].prev;
    s.players[i].meter = old[i].meter;
  }
  s.ball.x = s.server === 0 ? -4 : 4;
  s.ball.y = 4.5;
  s.ball.vx = 0;
  s.ball.vy = 0;
  clearBallFx(s.ball);
  s.lastSide = -1;
  s.touches = 0;
  s.rally = 0;
  s.heat = 0;
  s.hazards.length = 0;
  s.heckleTimer = 240 + (hz(s.score[0] * 7 + s.score[1] * 13 + 5) % 240);
  s.phase = "serve";
  s.timer = 45;
}

function award(s: GameState, winner: number, fault: boolean): void {
  s.score[winner]++;
  for (let i = 0; i < s.players.length; i++) if (sideOf(i) !== winner) addMeter(s, i, METER_CONCEDE);
  clearBallFx(s.ball);
  s.server = winner;
  s.phase = "point";
  s.timer = 75;
  s.events.push({ type: "score", winner, fault });
}

// Pengali kecepatan bola dari panas reli: 1.0 sampai 1.5.
export function heatMul(s: GameState): number {
  return 1 + HEAT_STEP * Math.min(s.heat, HEAT_MAX);
}

// Makin banyak pemain makin susah bola jatuh, jadi di mode tim reli memanas lebih cepat.
function heatGain(s: GameState): number {
  const team = s.players.length >> 1;
  return team > 1 ? team + 1 : 1;
}

function addMeter(s: GameState, i: number, amount: number): void {
  const p = s.players[i];
  // Di mode tim meter terisi lebih pelan, supaya jurus tidak keluar bertubi-tubi.
  const team = s.players.length >> 1;
  p.meter = Math.min(METER_MAX, p.meter + (amount * (CHARS[s.chars[i]].charge ?? 1)) / (team > 1 ? team * 0.8 : 1));
}

function pressed(p: Player, input: number, bit: number): boolean {
  return (input & bit) !== 0 && (p.prev & bit) === 0;
}

function stepPlayer(s: GameState, i: number, rawInput: number): void {
  const p = s.players[i];
  // Terhuyung: semua input diabaikan sampai pulih.
  let input = rawInput;
  if (p.stun > 0) {
    p.stun--;
    input = 0;
  }
  const c = CHARS[s.chars[i]];
  const side = sideOf(i) === 0 ? -1 : 1;
  const ax = (input & Btn.RIGHT ? 1 : 0) - (input & Btn.LEFT ? 1 : 0);

  // Membidik smash: karakter mengapung diam, arah diambil dari input, bola dilepas saat tombol dilepas.
  if (p.aimTimer > 0) {
    if (p.stun > 0) {
      // Terhuyung saat membidik: batal, bola jatuh biasa.
      p.aimTimer = 0;
      p.smashRecover = SMASH_RECOVER;
    } else {
      p.aimX = ax;
      p.aimY = (input & Btn.UP ? 1 : 0) - (input & Btn.DOWN ? 1 : 0);
      p.vx = 0;
      p.vy = 0;
      p.dashTimer = 0;
      p.aimTimer--;
      const spent = AIM_MAX - p.aimTimer;
      if (p.aimTimer === 0 || ((input & Btn.SMASH) === 0 && spent >= AIM_MIN)) {
        p.aimTimer = 0;
        launchSmash(s, i, input, p.aimPerfect, p.aimElapsed);
      }
      return;
    }
  }

  if (p.dashCd > 0) p.dashCd--;
  if (p.hitCd > 0) p.hitCd--;

  // Special dan smash: jendela aktif, lalu recovery (tidak bisa menyerang lagi).
  if (p.specialTimer > 0) {
    p.specialTimer--;
    if (p.specialTimer === 0) {
      p.smashRecover = SPECIAL_WHIFF_RECOVER;
      s.events.push({ type: "miss", player: i, kind: "special" });
    }
  } else if (p.smashTimer > 0) {
    p.smashTimer--;
    if (p.smashTimer === 0) {
      p.smashRecover = SMASH_RECOVER;
      s.events.push({ type: "miss", player: i, kind: "smash" });
    }
  } else if (p.guardTimer > 0) {
    p.guardTimer--;
    if (p.guardTimer === 0) {
      p.smashRecover = GUARD_RECOVER;
      s.events.push({ type: "miss", player: i, kind: "guard" });
    }
  } else if (p.smashRecover > 0) {
    p.smashRecover--;
  } else if (pressed(p, input, Btn.GUARD)) {
    p.guardTimer = GUARD_ACTIVE;
    s.events.push({ type: "guard", player: i });
  } else if (pressed(p, input, Btn.SPECIAL) && p.meter >= SPECIAL_COST) {
    // Meter belum dipotong di sini: baru dipotong kalau jurusnya benar-benar mengenai bola.
    p.specialTimer = SPECIAL_ARMED;
    s.hitstop = SUPER_FREEZE; // semua membeku sesaat: momen "ulti"
    s.events.push({ type: "special", player: i });
  } else if (pressed(p, input, Btn.SMASH)) {
    p.smashTimer = SMASH_ACTIVE;
    s.events.push({ type: "whiff", player: i });
  }

  // Dash: sekali di udara, cooldown di darat.
  if (p.dashTimer === 0 && pressed(p, input, Btn.DASH)) {
    const canDash = p.grounded ? p.dashCd === 0 : !p.airDashUsed;
    if (canDash) {
      const dir = ax !== 0 ? ax : p.facing;
      p.dashTimer = DASH_FRAMES;
      p.dashCd = DASH_COOLDOWN;
      p.vx = dir * DASH_SPEED;
      p.vy = 0;
      if (!p.grounded) p.airDashUsed = true;
      s.events.push({ type: "dash", player: i, dir });
    }
  }

  if (p.dashTimer > 0) {
    p.dashTimer--;
    if (p.dashTimer === 0) p.vx *= 0.45;
  } else {
    const target = ax * c.moveSpeed;
    p.vx += (target - p.vx) * (p.grounded ? 0.35 : 0.16);
    const fastFall = !p.grounded && (input & Btn.DOWN) !== 0 && p.vy < 2;
    p.vy -= PLAYER_GRAVITY * (fastFall ? 1.7 : 1) * DT;
  }

  if (pressed(p, input, Btn.JUMP) && p.jumpsLeft > 0) {
    p.vy = p.grounded ? c.jumpV : c.jumpV * 0.88;
    p.jumpsLeft--;
    p.grounded = false;
    p.dashTimer = 0;
    s.events.push({ type: "jump", player: i });
  }

  p.x += p.vx * DT;
  p.y += p.vy * DT;

  if (p.y <= 0) {
    p.y = 0;
    p.vy = 0;
    if (!p.grounded) s.events.push({ type: "land", player: i });
    p.grounded = true;
    p.jumpsLeft = 2;
    p.airDashUsed = false;
  } else {
    p.grounded = false;
    if (p.jumpsLeft === 2) p.jumpsLeft = 1; // jatuh dari darat tanpa lompat
  }

  // Pemain tidak boleh menyeberang net atau keluar lapangan.
  const ox = p.x * side;
  if (ox < PLAYER_MIN_X) {
    p.x = PLAYER_MIN_X * side;
    p.vx = 0;
  } else if (ox > PLAYER_MAX_X) {
    p.x = PLAYER_MAX_X * side;
    p.vx = 0;
  }
}

// Arah lepasan smash (vektor satuan) dari arah yang ditahan; tanpa arah, bola menukik ke depan.
// Dipakai juga oleh tampilan untuk menggambar panah bidik.
export function smashDir(grounded: boolean, ax: number, ay: number, dir: number): [number, number] {
  let nx = ax;
  let ny = ay;
  if (nx === 0 && ny === 0) {
    nx = dir;
    ny = grounded ? 0.6 : -0.35;
  } else if (nx !== 0 && ny === 0) {
    ny = grounded ? 0.25 : -0.12;
  }
  const len = Math.hypot(nx, ny);
  return [nx / len, ny / len];
}

// Melepas smash: arah dari input saat ini, kecepatan dari karakter, panas, dan penggandaan timing sempurna.
function launchSmash(s: GameState, i: number, input: number, perfect: boolean, elapsed: number): void {
  const p = s.players[i];
  const b = s.ball;
  const c = CHARS[s.chars[i]];
  const dir = sideOf(i) === 0 ? 1 : -1;
  const ax = (input & Btn.RIGHT ? 1 : 0) - (input & Btn.LEFT ? 1 : 0);
  const ay = (input & Btn.UP ? 1 : 0) - (input & Btn.DOWN ? 1 : 0);
  const [ux, uy] = smashDir(p.grounded, ax, ay, dir);
  const speed = c.smashSpeed * heatMul(s) * (perfect ? PERFECT_BOOST : 1);
  b.vx = ux * speed + p.vx * 0.3;
  b.vy = uy * speed;
  p.smashTimer = 0;
  p.smashRecover = SMASH_RECOVER;
  addMeter(s, i, perfect ? METER_PERFECT : METER_SMASH);
  s.heat += (perfect ? 2 : 1) * heatGain(s);
  s.hitstop = 5 + Math.floor(Math.min(s.heat, HEAT_MAX) / 6) + (perfect ? 3 : 0);
  s.events.push({ type: "smash", player: i, x: b.x, y: b.y, perfect, elapsed });
}

function tryHit(s: GameState, i: number, input: number): void {
  const p = s.players[i];
  const b = s.ball;
  if (p.hitCd > 0) return;
  // Pemain yang sedang terhuyung tidak bisa menyentuh bola sama sekali; kalau tidak,
  // bola yang baru saja membuatnya kewalahan akan "terselamatkan" sendiri oleh badannya.
  if (p.stun > 0) return;
  // Bola jurus tidak melukai pemukulnya sendiri: selama efeknya masih aktif, bola itu
  // menembus badan pemiliknya.
  const team = sideOf(i);
  const ownFx =
    s.lastSide === team && (b.power > 0 || b.curveSide >= 0 || b.wave > 0 || b.rise > 0 || b.ghost > 0);
  if (ownFx) return;

  const c = CHARS[s.chars[i]];
  const special = p.specialTimer > 0;
  const smashing = p.smashTimer > 0;
  const guarding = p.guardTimer > 0;
  // Bola jurus hanya bisa di-smash balik dengan timing sempurna.
  const smashElapsed = SMASH_ACTIVE - p.smashTimer;
  const smashPerfect = smashing && smashElapsed >= PERFECT_FROM && smashElapsed <= PERFECT_TO;
  const reach = (special ? SPECIAL_R : smashing ? SMASH_R : guarding ? GUARD_R : BODY_R) + BALL_R;
  const dx = b.x - p.x;
  const dy = b.y - (p.y + BODY_Y);
  if (dx * dx + dy * dy > reach * reach) return;

  if (s.lastSide !== team) {
    s.lastSide = team;
    s.touches = 0;
  }
  s.touches++;
  if (s.touches > MAX_TOUCHES) {
    award(s, 1 - team, true);
    return;
  }

  s.rally++;

  const dir = team === 0 ? 1 : -1;
  const ax = (input & Btn.RIGHT ? 1 : 0) - (input & Btn.LEFT ? 1 : 0);
  const ay = (input & Btn.UP ? 1 : 0) - (input & Btn.DOWN ? 1 : 0);
  p.hitCd = HIT_COOLDOWN;
  // Seberapa berbahaya bola yang datang, dicatat sebelum efeknya dihapus.
  const speedIn = Math.hypot(b.vx, b.vy);
  const hadFx = b.power > 0 || b.curveSide >= 0 || b.wave > 0 || b.rise > 0 || b.ghost > 0;
  // Hanya jurus api yang "berat": kalau kena badan tanpa diterima, hampir pasti jadi poin.
  // Jurus lain mengandalkan tipuan arah atau mata, jadi hukumannya seperti smash biasa.
  const heavyFx = b.power > 0 && b.rise === 0 && Math.abs(b.vx) > 1;
  const hard = speedIn > HARD_SPEED || hadFx;
  clearBallFx(b);

  if (special) {
    p.specialTimer = 0;
    p.smashRecover = SPECIAL_RECOVER;
    p.meter = Math.max(0, p.meter - SPECIAL_COST); // jurus jadi: baru sekarang meternya terpakai
    if (c.special === "fire") {
      // Jurus api: bola melesat lurus tanpa gravitasi, dibidik ke lantai lapangan lawan.
      // Tahan maju = jauh, tahan mundur = dekat net, netral = tengah.
      const fwdHeld = ax * dir;
      const tx = dir * (fwdHeld > 0 ? 6.4 : fwdHeld < 0 ? 2.3 : 4.3);
      let nx = tx - b.x;
      let ny = -b.y;
      // Kalau garis lurus ke sasaran tersangkut net, bidik sedikit di atas pita net saja.
      const span = (tx - b.x) * dir;
      const yAtNet = span > 0.01 ? b.y * (1 - Math.max(0, -b.x * dir) / span) : 0;
      let frames = FIRE_FRAMES;
      b.tx = tx;
      if (b.x * dir < 0 && yAtNet < NET_H + 0.45) {
        // Dua ruas: naik dulu ke titik di atas net, lalu berbelok ke sasaran di lantai.
        nx = dir * 0.35 - b.x;
        ny = NET_H + 0.9 - b.y;
        frames = Math.max(2, Math.ceil(Math.hypot(nx, ny) / (FIRE_SPEED * DT)));
        b.waveBase = 1; // penanda: belok setelah ruas pertama habis
      }
      const len = Math.hypot(nx, ny) || 1;
      b.vx = (nx / len) * FIRE_SPEED;
      b.vy = (ny / len) * FIRE_SPEED;
      b.power = frames;
      s.hitstop = 9;
    } else if (c.special === "curve") {
      // Bola Pelintir: lob tinggi yang menukik tajam begitu melewati net.
      const tApex = 0.62;
      b.vx = dir * Math.max(4, (Math.abs(b.x) + 1) / tApex);
      b.vy = 13;
      b.curveSide = team;
      s.hitstop = 6;
    } else if (c.special === "zigzag") {
      // Zig-zag: bola melaju mendatar sambil naik-turun, susah ditebak tingginya.
      b.vx = dir * WAVE_SPEED;
      b.vy = 0;
      b.wave = WAVE_FRAMES;
      b.waveT = 0;
      b.tx = dir;
      b.waveBase = Math.max(b.y, NET_H + 1.0);
      s.hitstop = 6;
    } else if (c.special === "meteor") {
      // Blusukan: bola naik tinggi lalu jatuh lurus di titik pilihan.
      // Tahan maju = jauh, tahan mundur = dekat net, netral = tengah.
      const fwdHeld = ax * dir;
      b.tx = dir * (fwdHeld > 0 ? 6.3 : fwdHeld < 0 ? 1.7 : 4.0);
      b.rise = METEOR_RISE;
      b.vx = (b.tx - b.x) / (METEOR_RISE * DT);
      b.vy = (METEOR_TOP - b.y) / (METEOR_RISE * DT);
      s.hitstop = 7;
    } else {
      // Siluman: smash cepat yang bolanya nyaris tak terlihat untuk sesaat.
      let nx = ax;
      let ny = ay;
      if (nx === 0 && ny === 0) {
        nx = dir;
        ny = p.grounded ? 0.45 : -0.3;
      } else if (nx !== 0 && ny === 0) {
        ny = p.grounded ? 0.25 : -0.1;
      }
      // Kalau bidikannya ke arah net tapi bakal nyangkut, sudutnya dinaikkan sedikit demi
      // sedikit sampai lolos: jurus yang sudah kena tidak boleh mati di net.
      if (nx * dir > 0 && b.x * dir < 0) {
        for (let k = 0; k < 40; k++) {
          const l = Math.hypot(nx, ny);
          const t = Math.abs(b.x) / ((Math.abs(nx) / l) * GHOST_SPEED);
          const yAtNet = b.y + (ny / l) * GHOST_SPEED * t - 0.5 * BALL_GRAVITY * t * t;
          if (yAtNet > NET_H + NET_R + BALL_R + 0.3) break;
          ny += 0.15;
        }
      }
      const len = Math.hypot(nx, ny);
      b.vx = (nx / len) * GHOST_SPEED;
      b.vy = (ny / len) * GHOST_SPEED;
      b.ghost = GHOST_FRAMES;
      s.hitstop = 6;
    }
    s.heat += 2 * heatGain(s);
    s.events.push({ type: "specialHit", player: i, kind: c.special, x: b.x, y: b.y });
  } else if (smashing && (!hadFx || smashPerfect)) {
    const perfect = smashPerfect;
    p.smashTimer = 0;
    if ((input & Btn.SMASH) !== 0) {
      // Tombol masih ditahan: karakter dan bola mengapung, pemain memilih arah.
      p.aimTimer = AIM_MAX;
      p.aimPerfect = perfect;
      p.aimElapsed = smashElapsed;
      p.aimX = ax;
      p.aimY = ay;
      p.vx = 0;
      p.vy = 0;
      p.dashTimer = 0;
      b.vx = 0;
      b.vy = 0;
      s.events.push({ type: "aimStart", player: i, x: b.x, y: b.y });
    } else {
      // Tekan-lepas cepat: langsung melesat.
      launchSmash(s, i, input, perfect, smashElapsed);
    }
  } else {
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : 0;
    const uy = d > 1e-6 ? dy / d : 1;
    const guardElapsed = GUARD_ACTIVE - p.guardTimer;
    const perfect = guarding && guardElapsed <= GUARD_PERFECT;
    if (guarding) {
      // Terima: bola dijinakkan jadi umpan pelan di dekat badan.
      b.vx = dir * 0.8 + ax * 2;
      b.vy = perfect ? 11 : 9.5;
      p.guardTimer = 0;
      p.smashRecover = perfect ? 0 : 6; // terima sempurna: langsung bisa menyerang balik
      addMeter(s, i, (perfect ? METER_RECEIVE_PERFECT : METER_RECEIVE) + (hadFx ? 10 : 0));
      s.hitstop = perfect ? 6 : 3;
      s.events.push({ type: "receive", player: i, x: b.x, y: b.y, perfect, elapsed: guardElapsed });
    } else if (hard) {
      // Kewalahan: bola kencang cuma kesenggol badan (atau bola api menjebol terima biasa),
      // terpental tak terkendali.
      if (guarding) {
        p.guardTimer = 0;
        p.smashRecover = GUARD_RECOVER;
      }
      if (smashing) {
        p.smashTimer = 0;
        p.smashRecover = SMASH_RECOVER;
      }
      // Bola menyerempet badan dan terus melaju ke belakang dengan sebagian kecepatannya.
      // (Tidak dipantulkan balik: itu sama saja mengembalikan bola ke lawan.)
      // Bola jurus yang sama sekali tidak diterima jatuhnya dekat dan cepat, dan pemain
      // terhuyung sebentar: hanya karakter gesit yang masih sempat mengejar. Kalau sempat
      // memasang terima (walau tidak sempurna), akibatnya seringan smash biasa.
      const harsh = heavyFx && !guarding;
      p.stun = harsh ? 24 : guarding ? 0 : 9;
      b.vx *= harsh ? 0.2 : 0.35;
      if (Math.abs(b.vx) < 2.5) b.vx = -dir * 3.5; // bola dari atas terpental ke arah belakang
      b.vy = harsh ? 1.6 : speedIn * 0.18 + 3;
      s.events.push({ type: "touch", player: i, x: b.x, y: b.y, weak: true });
    } else {
      // Sentuhan biasa: bola diangkat, arah stick menentukan ke mana.
      b.vx = dir * 2.5 + ax * 3 + p.vx * 0.5;
      b.vy = 10 + (ay > 0 ? 2 : 0) + Math.max(0, p.vy) * 0.25;
      addMeter(s, i, METER_TOUCH);
      s.events.push({ type: "touch", player: i, x: b.x, y: b.y, weak: false });
    }
    b.x = p.x + ux * reach;
    b.y = Math.max(BALL_R + 0.01, p.y + BODY_Y + uy * reach);
  }
}

function stepBall(s: GameState, inputs: readonly number[]): void {
  const b = s.ball;
  // Ada yang sedang membidik smash: bola diam di tempatnya dan tidak bisa disentuh siapa pun.
  for (const q of s.players) if (q.aimTimer > 0) return;
  const h = DT / BALL_SUBSTEPS;
  let powered = b.power > 0;
  if (powered) b.power--;
  // Jurus api ruas kedua: sampai di atas net, berbelok lurus ke sasaran di lantai.
  if (powered && b.power === 0 && b.waveBase === 1 && b.wave === 0 && b.rise === 0) {
    const nx = b.tx - b.x;
    const ny = -b.y;
    const len = Math.hypot(nx, ny) || 1;
    b.vx = (nx / len) * FIRE_SPEED;
    b.vy = (ny / len) * FIRE_SPEED;
    b.waveBase = 0;
    b.power = FIRE_FRAMES;
  }
  if (b.ghost > 0) b.ghost--;

  if (b.rise > 0) {
    // Fase naik Bola Blusukan; di puncak bola berhenti lalu jatuh lurus.
    powered = true;
    if (--b.rise === 0) {
      b.vx = 0;
      b.vy = -METEOR_SPEED;
      b.power = 40;
      s.events.push({ type: "curveDrop" });
    }
  } else if (b.wave > 0) {
    // Zig-zag: kecepatan vertikal diatur supaya bola mengikuti gelombang.
    powered = true;
    // b.tx menyimpan arah maju bola zig-zag (+1 atau -1).
    const wdir = b.tx >= 0 ? 1 : -1;
    // Selama masih rendah di sisi sendiri, bola naik dulu hampir tegak supaya tidak
    // menabrak net; gelombangnya baru berjalan setelah cukup tinggi.
    const climbing = b.x * wdir < 0 && b.y < NET_H + 0.75;
    if (b.x * wdir > 5.6) {
      // Sudah jauh di lapangan lawan: gelombang selesai dan bola menukik ke lantai belakang.
      b.wave = 0;
      b.vy = Math.min(b.vy, -7);
    } else if (climbing) {
      b.vy = 16;
      b.vx = wdir * 2.5;
      b.waveBase = Math.max(b.waveBase, b.y);
    } else {
      b.wave--;
      b.waveT++;
      // Tinggi di sisi sendiri supaya lolos dari net, lalu turun setinggi badan di sisi lawan.
      const center = b.x * wdir > 0.6 ? WAVE_LOW : WAVE_HEIGHT;
      b.waveBase += Math.min(0.24, Math.max(-0.24, (center - b.waveBase) * 0.2));
      const want = b.waveBase + WAVE_AMP * Math.sin(WAVE_OMEGA * b.waveT);
      b.vy = Math.min(16, Math.max(-16, (want - b.y) / DT));
      b.vx = wdir * WAVE_SPEED;
    }
  }
  const maxSpeed = powered ? BALL_POWER_MAX_SPEED : BALL_MAX_SPEED * heatMul(s);

  for (let n = 0; n < BALL_SUBSTEPS; n++) {
    if (!powered) b.vy -= BALL_GRAVITY * h;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > maxSpeed) {
      b.vx *= maxSpeed / speed;
      b.vy *= maxSpeed / speed;
    }
    b.x += b.vx * h;
    b.y += b.vy * h;

    // Bola Pelintir menukik setelah melewati net ke sisi lawan.
    if (b.curveSide >= 0) {
      const dir = b.curveSide === 0 ? 1 : -1;
      if (b.x * dir > 0.5) {
        b.vx = dir * 1.2;
        b.vy = -15.5;
        b.curveSide = -1;
        s.events.push({ type: "curveDrop" });
      }
    }

    // Dinding samping dan langit-langit.
    if (b.x < -COURT_HALF + BALL_R) {
      b.x = -COURT_HALF + BALL_R;
      b.vx = Math.abs(b.vx) * 0.8;
      s.events.push({ type: "bounce" });
    } else if (b.x > COURT_HALF - BALL_R) {
      b.x = COURT_HALF - BALL_R;
      b.vx = -Math.abs(b.vx) * 0.8;
      s.events.push({ type: "bounce" });
    }
    if (b.y > CEILING - BALL_R) {
      b.y = CEILING - BALL_R;
      b.vy = -Math.abs(b.vy) * 0.8;
    }

    // Net: kapsul dari (0,0) sampai (0,NET_H).
    const cy = Math.min(Math.max(b.y, 0), NET_H);
    const nx = b.x;
    const ny = b.y - cy;
    const dist = Math.hypot(nx, ny);
    const minDist = BALL_R + NET_R;
    if (dist < minDist) {
      let ux: number;
      let uy: number;
      if (dist > 1e-6) {
        ux = nx / dist;
        uy = ny / dist;
      } else {
        ux = b.vx > 0 ? -1 : 1;
        uy = 0;
      }
      b.x = ux * minDist;
      b.y = cy + uy * minDist;
      const vn = b.vx * ux + b.vy * uy;
      if (vn < 0) {
        b.vx -= 1.6 * vn * ux;
        b.vy -= 1.6 * vn * uy;
        s.events.push({ type: "bounce" });
      }
    }

    for (let i = 0; i < s.players.length; i++) {
      tryHit(s, i, inputs[i] ?? 0);
      if (s.phase !== "play") return;
    }
    if (s.hitstop > 0) return;

    // Bola menyentuh lantai: poin untuk sisi seberang.
    if (b.y <= BALL_R) {
      b.y = BALL_R;
      b.vx = 0;
      b.vy = 0;
      award(s, b.x < 0 ? 1 : 0, false);
      return;
    }
  }
}

// Penonton usil: sesekali melempar sesuatu ke pemain yang sedang unggul. Semuanya
// ditentukan dari state (tanpa acak sungguhan), jadi tetap bisa diulang persis.
// Penonton manusia: menggeser bidikan, mengisi amunisi, dan melempar.
function stepSpectator(s: GameState, input: number): void {
  const sp = s.spec;
  if (!sp.active) return;
  const lim = COURT_HALF - 0.7;
  const ax = (input & Btn.RIGHT ? 1 : 0) - (input & Btn.LEFT ? 1 : 0);
  sp.x = Math.min(lim, Math.max(-lim, sp.x + ax * SPEC_SPEED * DT));
  sp.ammo = Math.min(SPEC_MAX_AMMO, sp.ammo + 1 / SPEC_RECHARGE);

  // Tombol smash = kulit pisang, tombol lompat = sandal.
  const kind: HazardKind | null =
    input & Btn.SMASH && !(sp.prev & Btn.SMASH) ? "peel" : input & Btn.JUMP && !(sp.prev & Btn.JUMP) ? "sandal" : null;
  sp.prev = input;
  if (!kind || s.phase !== "play") return;

  const side = sp.x < 0 ? 0 : 1;
  if (Math.abs(sp.x) < SPEC_NET_GAP) s.events.push({ type: "heckleDenied", reason: "net" });
  else if (sp.ammo < 1 || s.hazards.length >= 4) s.events.push({ type: "heckleDenied", reason: "ammo" });
  else if (side === sp.lastSide) s.events.push({ type: "heckleDenied", reason: "side" });
  else {
    sp.ammo -= 1;
    sp.lastSide = side;
    s.hazards.push({ kind, x: sp.x, y: kind === "peel" ? 0 : 9.5, warn: HECKLE_WARN, life: PEEL_LIFE });
    s.events.push({ type: "heckle", kind, x: sp.x, side });
  }
}

function stepHazards(s: GameState): void {
  // Lemparan otomatis hanya kalau tidak ada penonton manusia.
  if (!s.spec.active && s.rowdy && --s.heckleTimer <= 0) {
    const h = hz(s.frame * 31 + s.rally * 7 + s.score[0] * 3 + s.score[1]);
    // Yang diusili pemain yang unggul; kalau seri, bergantian.
    const targetSide = s.score[0] > s.score[1] ? 0 : s.score[1] > s.score[0] ? 1 : (h >>> 3) & 1;
    // Di mode tim, salah satu anggota sisi itu yang diincar.
    const target = targetSide + 2 * ((h >>> 5) % (s.players.length >> 1));
    const p = s.players[target];
    const side = target === 0 ? -1 : 1;
    const kind: HazardKind = h % 100 < 55 ? "peel" : "sandal";
    const jitter = (((h >>> 8) % 5) - 2) * 0.2;
    // Kulit pisang jatuh di depan arah lari; sandal mengincar posisi pemain sebentar lagi.
    let x = kind === "peel" ? p.x + (Math.sign(p.vx) || -side) * 1.5 + jitter : p.x + p.vx * 0.6 + jitter;
    x = Math.min(Math.max(x * side, 0.9), COURT_HALF - 0.7) * side;
    s.hazards.push({ kind, x, y: kind === "peel" ? 0 : 9.5, warn: HECKLE_WARN, life: PEEL_LIFE });
    s.heckleTimer = 420 + ((h >>> 12) % 360); // 7 sampai 13 detik
    s.events.push({ type: "heckle", kind, x, side: targetSide });
  }

  for (let k = s.hazards.length - 1; k >= 0; k--) {
    const hzd = s.hazards[k];
    if (hzd.warn > 0) {
      hzd.warn--;
      continue;
    }
    if (hzd.kind === "peel") {
      // Kepleset: pemain yang berlari di tanah melewati kulit pisang. Melompatinya aman.
      let gone = --hzd.life <= 0;
      for (let i = 0; i < s.players.length && !gone; i++) {
        const p = s.players[i];
        if (p.grounded && p.stun === 0 && Math.abs(p.vx) > 0.8 && Math.abs(p.x - hzd.x) < PEEL_R) {
          p.stun = SLIP_STUN;
          p.vx = Math.sign(p.vx) * 10;
          p.dashTimer = 0;
          s.events.push({ type: "slip", player: i });
          gone = true;
        }
      }
      if (gone) s.hazards.splice(k, 1);
    } else {
      // Sandal jatuh dari atas: menyenggol bola, atau membuat pemain terhuyung.
      hzd.y -= SANDAL_FALL * DT;
      const b = s.ball;
      let gone = hzd.y <= 0;
      if (!gone && Math.hypot(b.x - hzd.x, b.y - hzd.y) < SANDAL_R + BALL_R) {
        b.vx += (b.x >= hzd.x ? 1 : -1) * 3.5;
        b.vy = Math.abs(b.vy) * 0.5 + 4;
        s.events.push({ type: "bonk", target: "ball", player: -1, x: hzd.x, y: hzd.y });
        gone = true;
      }
      for (let i = 0; i < s.players.length && !gone; i++) {
        const p = s.players[i];
        if (Math.abs(p.x - hzd.x) < SANDAL_R && hzd.y > p.y && hzd.y < p.y + 1.8) {
          p.stun = Math.max(p.stun, SANDAL_STUN);
          s.events.push({ type: "bonk", target: "player", player: i, x: hzd.x, y: hzd.y });
          gone = true;
        }
      }
      if (gone) s.hazards.splice(k, 1);
    }
  }
}

export function step(s: GameState, inputs: readonly number[], specInput = 0): void {
  s.events.length = 0;

  // Hitstop: semua membeku beberapa frame setelah smash kena.
  if (s.hitstop > 0) {
    s.hitstop--;
    return;
  }
  s.frame++;

  if (s.phase === "over") {
    let any = false;
    for (let i = 0; i < s.players.length; i++) {
      if (pressed(s.players[i], inputs[i] ?? 0, Btn.JUMP | Btn.SMASH)) any = true;
      s.players[i].prev = inputs[i] ?? 0;
    }
    if (s.timer > 0) s.timer--;
    else if (any) {
      s.score = [0, 0];
      for (const p of s.players) p.meter = 0;
      s.server = 0;
      startServe(s);
    }
    return;
  }

  for (let i = 0; i < s.players.length; i++) stepPlayer(s, i, inputs[i] ?? 0);
  stepSpectator(s, specInput);

  if (s.phase === "serve") {
    if (--s.timer <= 0) s.phase = "play";
  } else if (s.phase === "play") {
    stepBall(s, inputs);
    if (s.phase === "play" && s.hitstop === 0) stepHazards(s);
  } else if (s.phase === "point") {
    if (--s.timer <= 0) {
      const winner = gameWinner(s.score[0], s.score[1], s.winScore, s.winCap);
      if (winner >= 0) {
        s.phase = "over";
        s.timer = 40;
        s.events.push({ type: "over", winner });
      } else {
        startServe(s);
      }
    }
  }

  for (let i = 0; i < s.players.length; i++) s.players[i].prev = inputs[i] ?? 0;
}

// CPU sederhana untuk sisi kanan. Deterministik: hanya membaca state.
// Tingkat CPU: 0 mudah, 1 normal, 2 sulit. Angkanya peluang (persen) tiap keputusan.
const CPU_LEVELS = [
  { jump: 40, smash: 45, perfect: 2, special: 30, sharp: 4, guard: 26, lazy: 3, miss: 24, readCurve: 25 },
  { jump: 70, smash: 85, perfect: 18, special: 60, sharp: 25, guard: 62, lazy: 0, miss: 9, readCurve: 55 },
  { jump: 85, smash: 94, perfect: 42, special: 78, sharp: 55, guard: 60, lazy: 0, miss: 5, readCurve: 40 },
] as const;

// Apakah smash dari posisi bola sekarang dengan kemiringan ny (menukik < 0) melewati net.
function cpuClearsNet(s: GameState, i: number, ny: number): boolean {
  const b = s.ball;
  const smashV = CHARS[s.chars[i]].smashSpeed * heatMul(s);
  const len = Math.hypot(1, ny);
  const vx = smashV / len;
  const vy = (ny / len) * smashV;
  const t = Math.abs(b.x) / vx;
  const yAtNet = b.y + vy * t - 0.5 * BALL_GRAVITY * t * t;
  return yAtNet > NET_H + NET_R + BALL_R + 0.25;
}

export function cpuInput(s: GameState, i: number, level = 1): number {
  const L = CPU_LEVELS[Math.min(2, Math.max(0, level))];
  const p = s.players[i];
  const b = s.ball;
  const team = sideOf(i);
  const teamSize = s.players.length >> 1;
  const side = team === 0 ? -1 : 1;
  const toward = side === 1 ? Btn.LEFT : Btn.RIGHT; // arah ke net
  const away = side === 1 ? Btn.RIGHT : Btn.LEFT;
  let out = 0;

  if (s.phase === "over") return 0;

  // Sedang membidik smash: menahan tombol 3-10 frame (dari hash, bukan acak), lalu melepas
  // ke arah yang melewati net.
  if (p.aimTimer > 0) {
    const hold = 3 + ((Math.imul(s.rally * 9 + i * 5 + s.score[0] * 3 + s.score[1], 40503) >>> 0) % 8);
    let o = toward;
    if (cpuClearsNet(s, i, -1)) o |= Btn.DOWN;
    if (AIM_MAX - p.aimTimer < hold) o |= Btn.SMASH;
    return o;
  }

  const ballOnMySide = b.x * side > -0.3;
  const incoming = b.vx * side > 0.5;
  const home = homeX(teamSize, i);
  let targetX = home;

  if (s.phase !== "point" && (ballOnMySide || incoming)) {
    // Perkiraan titik jatuh bola di ketinggian badan (balistik, tanpa pantulan).
    const hitY = 1.3;
    const disc = b.vy * b.vy + 2 * BALL_GRAVITY * Math.max(0, b.y - hitY);
    const t = (b.vy + Math.sqrt(disc)) / BALL_GRAVITY;
    let px = b.x + b.vx * t;
    const lim = COURT_HALF - BALL_R;
    if (px > lim) px = lim - (px - lim) * 0.8;
    if (px < -lim) px = -lim + (-lim - px) * 0.8;
    if (px * side > 0.2) targetX = px + 0.35 * side; // berdiri sedikit di belakang bola
  }
  // Bola Blusukan lawan: CPU kadang membaca titik jatuhnya selagi bola masih naik.
  if (b.rise > 0 && b.tx * side > 0 && (Math.imul(s.rally + s.score[0] + 3, 40503) >>> 0) % 100 < 68) {
    targetX = b.tx + 0.3 * side;
  }
  // Bola Siluman: CPU juga "tidak melihat" bolanya, jadi tebakannya meleset.
  if (b.ghost > 0) {
    targetX += (((Math.imul(s.rally + 11, 2654435761) >>> 0) % 5) - 2) * 1.8;
  }
  // Bola Pelintir lawan akan menukik dekat net; CPU kadang membacanya, kadang tidak.
  if (b.curveSide === 1 - team && (Math.imul(s.score[0] + s.score[1] + 7, 40503) >>> 0) % 100 < L.readCurve) {
    targetX = 1.5 * side;
  }

  // Salah baca posisi: di sebagian reli CPU berdiri agak meleset dari titik jatuh bola.
  // Tidak berlaku untuk bola servis (reli masih 0): melongo melihat bola servis jatuh
  // bukan kesalahan yang wajar.
  if (s.rally > 0 && (Math.imul(s.rally * 3 + i * 7 + (s.score[0] + s.score[1]) * 5, 40503) >>> 0) % 100 < L.miss * (teamSize > 1 ? teamSize + 1.5 : 1) + (teamSize > 1 ? 6 : 0)) {
    // Di mode tim tiap anggota lebih sering salah baca: kalau tidak, bola nyaris tak pernah jatuh.
    targetX += 1.3 * side;
  }
  // Mode tim: hanya anggota yang paling dekat ke titik jatuh bola yang mengejar; yang lain
  // menjaga posisinya supaya tidak berebut dan menghabiskan jatah tiga sentuhan.
  let chasing = true;
  if (teamSize > 1) {
    const mine = Math.abs(p.x - targetX);
    for (let k = team; k < s.players.length; k += 2) {
      if (k === i || s.players[k].stun > 0) continue;
      const d = Math.abs(s.players[k].x - targetX);
      if (d < mine - 0.01 || (Math.abs(d - mine) <= 0.01 && k < i)) chasing = false;
    }
    if (!chasing) targetX = home;
  }
  const ox = Math.min(Math.max(targetX * side, PLAYER_MIN_X + 0.2), PLAYER_MAX_X - 0.2);
  const dxT = ox - p.x * side;
  // CPU mudah bergerak tersendat: tiap beberapa frame dia diam.
  const moving = L.lazy === 0 || s.frame % L.lazy !== 0;
  if (moving && dxT > 0.25) out |= away;
  else if (moving && dxT < -0.25) out |= toward;

  // Kulit pisang di jalur lari: CPU melompatinya. Mudah tidak pernah, Normal kadang, Sulit selalu.
  const hop = level >= 2 ? 100 : level === 1 ? 55 : 0;
  for (const hzd of s.hazards) {
    if (hzd.kind !== "peel" || hzd.warn > 0 || !p.grounded) continue;
    const ahead = (hzd.x - p.x) * Math.sign(p.vx || 1);
    if (Math.abs(p.vx) > 1 && ahead > 0 && ahead < 1.0 && hz((s.frame >>> 4) + i * 17) % 100 < hop) {
      if ((p.prev & Btn.JUMP) === 0) out |= Btn.JUMP;
    }
  }

  const dx = Math.abs(b.x - p.x);
  const dy = b.y - (p.y + BODY_Y);
  const roll = (Math.imul(s.frame >>> 3, 2654435761) >>> 0) % 100;

  // Yang tidak mengejar hanya bereaksi kalau bolanya memang datang ke badannya.
  const involved = chasing || Math.hypot(dx, dy) < 1.6;
  if (s.phase === "play" && ballOnMySide && involved) {
    // Lompat menyambut bola tinggi yang sedang turun.
    // Jauh dari net smash hampir pasti nyangkut, jadi CPU cukup mengoper.
    const nearNet = p.x * side < 3.4;
    if (nearNet && p.grounded && dx < 1.3 && b.y > 2.6 && b.y < 4.8 && b.vy < 1 && roll < L.jump) {
      if ((p.prev & Btn.JUMP) === 0) out |= Btn.JUMP;
    }
    // Smash kalau bola dalam jangkauan di udara dan sudah di atas net.
    // Sesekali CPU mengincar smash sempurna: menekan sekitar 3 frame sebelum bola
    // masuk jangkauan, dengan memperkirakan posisi bola dan dirinya sendiri.
    const LEAD = 3 * DT;
    const dNow = Math.hypot(b.x - p.x, dy);
    const dSoon = Math.hypot(
      b.x + b.vx * LEAD - (p.x + p.vx * LEAD),
      b.y + b.vy * LEAD - (p.y + p.vy * LEAD + BODY_Y),
    );
    const wantsPerfect = (Math.imul(s.rally * 7 + i * 13 + s.score[0] + s.score[1], 40503) >>> 0) % 100 < L.perfect;
    const anticipate = wantsPerfect && dNow > SMASH_R + BALL_R + 0.03 && dSoon < SMASH_R + BALL_R - 0.08;
    const inRange = dx < 1.3 && Math.abs(dy) < 1.2;
    if (
      nearNet &&
      !p.grounded &&
      (inRange || anticipate) &&
      b.y > NET_H + 0.5 &&
      p.smashRecover === 0 &&
      (roll < L.smash || anticipate)
    ) {
      // Pilih arah yang benar-benar melewati net: menukik kalau bisa, datar kalau tidak.
      // Kalau dua-duanya bakal nyangkut, CPU tidak memaksa smash.
      const clearsNet = (ny: number): boolean => cpuClearsNet(s, i, ny);
      const down = clearsNet(-1);
      const flat = clearsNet(-0.12);
      if (down || flat) {
        if ((p.prev & Btn.SMASH) === 0) out |= Btn.SMASH;
        out = (out & ~away) | toward;
        if (down) out |= Btn.DOWN;
      }
    }
    // Menahan tombol smash sampai kena, supaya masuk ke bidikan (dilepas lagi di blok bidik di atas).
    if (p.smashTimer > 0 && p.specialTimer === 0) out = ((out | Btn.SMASH) & ~away) | toward;
    // Jurus kalau meter cukup. Karena jurus sekarang siaga sampai bola kena, hampir semua
    // jenis aman dipakai dari mana saja setelah sentuhan sendiri.
    const ownBall = dx < 1.4 && Math.abs(dy) < 1.4 && s.touches >= 1 && s.lastSide === team;
    const specialOk = ownBall;
    if (p.meter >= SPECIAL_COST && specialOk && roll < L.special && p.smashRecover === 0) {
      out &= ~Btn.SMASH;
      if ((p.prev & Btn.SPECIAL) === 0) out |= Btn.SPECIAL;
      out = (out & ~away) | toward;
    }
    // Bertahan: bola berbahaya yang sebentar lagi sampai diterima dulu, tapi tidak selalu,
    // supaya serangan keras tetap bisa menembus.
    const speedNow = Math.hypot(b.vx, b.vy);
    // Bola Mencair tidak masuk hitungan: CPU sama butanya dengan pemain, jadi tidak bersiap menerima.
    const dangerous = b.ghost === 0 && (speedNow > HARD_SPEED || b.power > 0 || b.curveSide >= 0 || b.wave > 0);
    // Biasanya CPU menekan agak awal (terima biasa); sesekali pas di detik terakhir (sempurna).
    const sharp = (Math.imul(s.rally * 5 + i * 17 + s.score[0] + s.score[1] * 3, 40503) >>> 0) % 100 < L.sharp;
    const G_LEAD = (sharp ? 3 : 8) * DT;
    const dGuard = Math.hypot(
      b.x + b.vx * G_LEAD - (p.x + p.vx * G_LEAD),
      b.y + b.vy * G_LEAD - (p.y + p.vy * G_LEAD + BODY_Y),
    );
    const guardSkill = (Math.imul(s.rally * 11 + i * 29 + s.score[0] * 3 + s.score[1], 40503) >>> 0) % 100 < L.guard;
    const idle = p.smashTimer === 0 && p.specialTimer === 0 && p.guardTimer === 0 && p.smashRecover === 0;
    if (dangerous && guardSkill && idle && s.lastSide !== team && dGuard < GUARD_R + BALL_R - 0.05) {
      out &= ~(Btn.SMASH | Btn.SPECIAL);
      if ((p.prev & Btn.GUARD) === 0) out |= Btn.GUARD;
    }
    // Sentuhan terakhir harus dikirim ke seberang.
    if (dx < 1.4 && Math.abs(dy) < 1.5 && s.lastSide === team && s.touches >= 2) {
      out = (out & ~away) | toward;
    }
  }
  return out;
}
