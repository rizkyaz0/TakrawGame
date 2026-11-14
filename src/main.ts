import { loadAiBody } from "./aibody";
import { crowdSfx, getVolume, music, setBusLevel, setVolume, sfx, sillySfx, voice, VOLUME_STEPS } from "./audio";
import { loadSettings, saveSettings, settings } from "./settings";
import { ACHIEVEMENTS, checkAchievements, isUnlocked, loadProgress, progress, saveProgress, unlockWins } from "./progress";
import {
  deviceActive,
  deviceLabel,
  deviceOptions,
  devices,
  mouse,
  readSpectator,
  spectator,
  spectatorOptions,
  type SpecDevice,
  listPads,
  loadDevices,
  readAll,
  readInput,
  sameDevice,
  saveDevices,
  trackPads,
  type Device,
} from "./input";
import {
  broadcast,
  cleanCode,
  guestAim,
  guestBits,
  hostRoom,
  joinRoom,
  leaveRoom,
  net,
  roomLink,
  sendToHost,
  sweepGuests,
  type GuestCommand,
} from "./net";
import { Renderer } from "./render";
import { ARENAS, TIMES, type ArenaId, type TimeId } from "./scenery";
import { initTouch, setSpecialReady, setTouchRole, touchCapable, touchState } from "./touch";
import {
  BALL_R,
  BODY_Y,
  Btn,
  CHARS,
  COURT_HALF,
  SPEC_MAX_AMMO,
  GUARD_PERFECT,
  GUARD_R,
  PERFECT_FROM,
  PERFECT_TO,
  SMASH_R,
  sideOf,
  cpuInput,
  createState,
  DT,
  HEAT_MAX,
  heatMul,
  gameWinner,
  matchPointMask,
  MAX_TOUCHES,
  METER_MAX,
  SPECIAL_COST,
  step,
  type GameEvent,
  type GameState,
} from "./sim";

const state: GameState = createState([0, 1]);
const renderer = new Renderer();

const $ = (id: string) => document.getElementById(id)!;
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

const elScore = [$("s1"), $("s2")];
const elRally = $("rally");
const elHeat = $("heat");
const elMp = $("mp");
const elTension = $("tension");
const elCallout = $("callout");
const elPop = $("pop");
const elBanner = $("banner");
const elCutin = $("cutin");
const elDim = $("dim");
const elLines = $("lines");
const elFlash = $("flash");
const elHud = $("hud");
const elHelp = $("help");
const cards =[1, 2].map((n) => ({
  root: $(`c${n}`),
  name: $(`n${n}`),
  sp: $(`sp${n}`),
  meter: $(`m${n}`),
  fill: $(`m${n}`).firstElementChild as HTMLElement,
  pips: Array.from($(`t${n}`).children) as HTMLElement[],
}));

const shown = { score: [-1, -1], char: [-1, -1], rally: -1, heat: -1, over: false, mp: -1, phase: "", mates: ["", ""] };
const elMates = [$("mates1"), $("mates2")];

// ===== Alur aplikasi: judul -> pilih karakter -> pertandingan =====
type Mode = "title" | "settings" | "profile" | "join" | "controls" | "select" | "match";
const app = {
  mode: "title" as Mode,
  paused: false,
  humans: 1 as 1 | 2, // 1 = lawan CPU, 2 = dua pemain di satu keyboard
  cpuLevel: 1,
  chars: [0, 1] as [number, number],
  locked: [false, false] as [boolean, boolean],
  titleIndex: 0,
  pauseIndex: 0,
  ctrlRow: 0, // baris yang disorot di layar pengaturan kontrol
  training: false,
  tutorial: false, // latihan terpandu langkah demi langkah
  teamSize: 1 as 1 | 2 | 3, // pemain per sisi
  mate: false, // mode tim dengan dua orang: pemain kedua jadi teman setim (bukan lawan)
  winScore: 7, // poin untuk menang
  arcade: { on: false, stage: 0, foes: [] as number[] }, // lima lawan berturut-turut, makin sulit
  arena: "acak" as ArenaId | "acak",
  time: "acak" as TimeId | "acak",
  setRow: 0, // baris yang disorot di layar pengaturan
  online: "off" as "off" | "host" | "client",
  seat: -1, // tamu online: 0/1 pemain, 2 penonton, -1 hanya menonton
};
const join = { status: "input" as "input" | "connecting" | "waiting" | "error", text: "" };
let roomError = "";

// ===== Mode latihan =====
const DRILLS = [
  { name: "Umpan smash", desc: "Bola dilambungkan ke dekatmu. Latih smash sempurna." },
  { name: "Serangan keras", desc: "Bola kencang ke badanmu. Latih terima sempurna." },
  { name: "Lawan jurus", desc: "Lawan memakai jurusnya terus. Latih cara menghadapinya." },
  { name: "Bebas", desc: "Main biasa lawan CPU, tanpa skor." },
];
const train = {
  drill: 0,
  launchPending: false,
  forceSpecial: 0,
  infiniteMeter: true,
  cue: true,
  smash: 0,
  smashPerfect: 0,
  recv: 0,
  recvPerfect: 0,
  streak: 0,
  best: 0,
};

function renderTrain(): void {
  $("drills").innerHTML = DRILLS.map(
    (d, k) =>
      `<div class="drill${k === train.drill ? " on" : ""}" data-tap="drill:${k}">${k + 1}. ${d.name}<small>${d.desc}</small></div>`,
  ).join("");
  $("tstats").innerHTML =
    `<span>Smash sempurna</span><b>${train.smashPerfect} / ${train.smash}</b>` +
    `<span>Terima sempurna</span><b>${train.recvPerfect} / ${train.recv}</b>` +
    `<span>Beruntun sempurna</span><b>${train.streak} (terbaik ${train.best})</b>`;
  $("tmeter").textContent = train.infiniteMeter ? "ya" : "tidak";
  $("tcue").textContent = train.cue ? "ya" : "tidak";
}

function trainResult(perfect: boolean): void {
  train.streak = perfect ? train.streak + 1 : 0;
  train.best = Math.max(train.best, train.streak);
  renderTrain();
}

// Mulai ulang giliran latihan: posisi direset, lalu bola dilepas sesuai jenis latihan.
function trainRestart(): void {
  Object.assign(state, createState(app.chars));
  state.timer = 14;
  train.launchPending = true;
  train.forceSpecial = 0;
}

function trainLaunch(): void {
  const s = state;
  const me = s.players[0];
  const b = s.ball;
  s.lastSide = 1;
  s.touches = 1;
  s.rally = 0;
  if (train.drill === 0) {
    // Lambung pelan yang turun sedikit di depan pemain, setinggi jangkauan lompat.
    const T = 1.15;
    const tx = Math.min(-0.9, me.x + 1.1);
    b.x = 2.6;
    b.y = 2.8;
    b.vx = (tx - b.x) / T;
    b.vy = (3.3 - b.y + 8 * T * T) / T;
  } else if (train.drill === 1) {
    // Tembakan keras lurus ke badan.
    // Dilepas dari cukup tinggi supaya garis lurusnya lolos dari net.
    b.x = 1.6;
    b.y = 4.3;
    const dx = me.x - b.x;
    const dy = me.y + 0.9 - b.y;
    const len = Math.hypot(dx, dy);
    b.vx = (dx / len) * 19;
    b.vy = (dy / len) * 19 + 1.2;
  } else if (train.drill === 2) {
    // Bola ditaruh di dekat lawan, lalu lawan dipaksa menekan jurus.
    const foe = s.players[1];
    foe.meter = 100;
    // Di luar jangkauan sentuhan badan, tapi masih di dalam jangkauan jurus.
    b.x = foe.x - 1.35;
    b.y = foe.y + 1.25;
    b.vx = 0;
    b.vy = 1.5;
    train.forceSpecial = 2;
  }
  // Latihan "Bebas" memakai servis biasa.
}

// Berapa frame lagi bola masuk jangkauan (0 = sudah di dalam, -1 = tidak dalam 9 frame).
function framesToReach(reach: number): number {
  const p = state.players[0];
  const b = state.ball;
  const floaty = b.power > 0 || b.wave > 0 || b.rise > 0;
  let bx = b.x;
  let by = b.y;
  let vy = b.vy;
  for (let n = 0; n <= 9; n++) {
    const px = p.x + p.vx * n * DT;
    const py = Math.max(0, p.y + p.vy * n * DT - 17 * (n * DT) * (n * DT)) + BODY_Y;
    if (Math.hypot(bx - px, by - py) < reach + BALL_R) return n;
    if (!floaty) vy -= 16 * DT;
    bx += b.vx * DT;
    by += vy * DT;
  }
  return -1;
}

// Petunjuk: cincin emas = tekan smash sekarang, cincin biru = tekan terima sekarang.
function updateCue(): void {
  renderer.cues[0] = null;
  if (!app.training || !train.cue || state.phase !== "play" || state.lastSide === 0) return;
  const p = state.players[0];
  if (p.smashTimer > 0 || p.guardTimer > 0 || p.specialTimer > 0 || p.smashRecover > 0) return;
  const toSmash = framesToReach(SMASH_R);
  const toGuard = framesToReach(GUARD_R);
  const fast = Math.hypot(state.ball.vx, state.ball.vy) > 14.5 || state.ball.power > 0 || state.ball.wave > 0;
  if (fast && toGuard >= 1 && toGuard <= GUARD_PERFECT) renderer.cues[0] = "guard";
  else if (!fast && toSmash >= PERFECT_FROM && toSmash <= PERFECT_TO) renderer.cues[0] = "smash";
}
const CPU_NAMES = ["Mudah", "Normal", "Sulit"];
// Urutan menu utama saat dinavigasi, mengikuti letaknya di layar.
const TITLE_ORDER = [0, 1, 7, 8, 9, 3, 4, 5, 2, 10, 6];
const ROLES = ["Power", "Lincah", "Tank", "Teknis", "Pelari", "Pelompat", "Seimbang"];
const SPECIAL_DESC: Record<string, string> = {
  fire: "Bola melesat lurus tanpa gravitasi.",
  curve: "Lob tinggi yang menukik begitu lewat net.",
  zigzag: "Bola melaju sambil naik-turun.",
  ghost: "Bola nyaris tak terlihat untuk sesaat.",
  meteor: "Bola naik tinggi lalu jatuh lurus. Tahan maju/mundur untuk mengatur jaraknya.",
};

function resetShown(): void {
  shown.score = [-1, -1];
  shown.char = [-1, -1];
  shown.rally = -1;
  shown.heat = -1;
  shown.over = false;
  shown.mp = -1;
  shown.phase = "";
  elBanner.classList.remove("on");
  elHud.dataset.over = "0"; // kalau tertinggal "1", tombol layar HP tetap tersembunyi
}

function setMode(mode: Mode): void {
  app.mode = mode;
  app.paused = false;
  elHud.dataset.mode = mode;
  elHud.dataset.paused = "0";
  if (mode !== "match") elHud.dataset.over = "0";
  music(mode === "match" ? "music_match" : "music_menu");
  elHud.dataset.training = app.training && mode === "match" ? "1" : "0";
  elHud.dataset.tutorial = app.tutorial && mode === "match" ? "1" : "0";
  renderer.cues[0] = null;
}

// Nomor pemain di simulasi untuk orang kedua: lawan (1) atau teman setim (2).
const slotOf = (human: number) => (human === 0 ? 0 : app.mate && app.teamSize > 1 ? 2 : 1);

// Susunan karakter semua pemain. Kapten dipilih di layar pilih jagoan; sisanya diisi acak
// dengan karakter yang belum dipakai.
function buildLineup(): number[] {
  const n = app.teamSize * 2;
  const out = new Array<number>(n).fill(-1);
  out[0] = app.chars[0];
  out[slotOf(1)] = app.chars[1];
  const free = CHARS.map((_, k) => k).filter((k) => !out.includes(k));
  for (let i = 0; i < n; i++) {
    if (out[i] >= 0) continue;
    out[i] = free.splice(Math.floor(Math.random() * free.length), 1)[0] ?? i % CHARS.length;
  }
  return out;
}

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
function applyArena(): void {
  const arena = app.arena === "acak" ? pick(ARENAS).id : app.arena;
  // Pasar malam paling cocok malam hari; arena lain bebas.
  const time = app.time !== "acak" ? app.time : arena === "pasarmalam" ? pick(["malam", "malam", "sore"] as const) : pick(TIMES).id;
  renderer.setArena(arena, time);
}
const WIN_OPTIONS = [5, 7, 11, 15];
const arenaName = () => (app.arena === "acak" ? "Acak" : ARENAS.find((a) => a.id === app.arena)!.name);
const timeName = () => (app.time === "acak" ? "Acak" : TIMES.find((t) => t.id === app.time)!.name);
function cycleOption(what: "arena" | "time" | "win"): void {
  if (what === "arena") {
    const ids: Array<ArenaId | "acak"> = ["acak", ...ARENAS.map((a) => a.id)];
    app.arena = ids[(ids.indexOf(app.arena) + 1) % ids.length];
  } else if (what === "time") {
    const ids: Array<TimeId | "acak"> = ["acak", ...TIMES.map((t) => t.id)];
    app.time = ids[(ids.indexOf(app.time) + 1) % ids.length];
  } else {
    app.winScore = WIN_OPTIONS[(WIN_OPTIONS.indexOf(app.winScore) + 1) % WIN_OPTIONS.length];
  }
  if (what !== "win") applyArena(); // pratinjau langsung di belakang layar pilih jagoan
  sfx.swing();
  renderSelect();
}

// Layar judul: pertandingan demo CPU lawan CPU berjalan di latar.
function startDemo(): void {
  renderer.setArena(pick(ARENAS).id, pick(TIMES).id);
  const a = Math.floor(Math.random() * CHARS.length);
  const b = (a + 1 + Math.floor(Math.random() * (CHARS.length - 1))) % CHARS.length;
  Object.assign(state, createState([a, b]));
}

// Keluar dari mabar online: tutup sambungan dan kembalikan kursi online ke alat lokal.
function endOnline(): void {
  if (app.online === "off") return;
  leaveRoom();
  app.online = "off";
  app.seat = -1;
  mouse.capture = false;
  roomError = "";
  setNetNote("");
  for (let i = 0; i < 2; i++) if (devices[i].kind === "net") devices[i] = { kind: "kbd", set: i as 0 | 1 };
  if (sameDevice(devices[0], devices[1])) devices[1] = { kind: "kbd", set: devices[0].kind === "kbd" && devices[0].set === 1 ? 0 : 1 };
  if (spectator.device.kind === "net") spectator.device = { kind: "none" };
}

const elNetNote = $("netNote");
let netNoteUntil = 0;
function setNetNote(text: string, seconds = 0): void {
  elNetNote.classList.remove("good");
  elNetNote.textContent = text;
  elNetNote.classList.toggle("on", text !== "");
  netNoteUntil = seconds > 0 ? performance.now() + seconds * 1000 : 0;
}

function goTitle(): void {
  endOnline();
  app.tutorial = false;
  app.arcade.on = false;
  setMode("title");
  startDemo();
  renderMenus();
}

// ===== Pengaturan kontrol =====
// Tiap pemain memilih alatnya sendiri: keyboard WASD, keyboard panah, atau salah satu stick.
const KEY_HELP = [
  "A D gerak · W lompat · S bawah · F smash · E terima · G dash · H jurus",
  "← → gerak · ↑ lompat · ↓ bawah · K smash · O terima · L dash · ; jurus",
];
const PAD_HELP = "D-pad/stick gerak · ✕ lompat · □ smash · L1 terima · ○ dash · △ jurus";
let hadSavedDevices = loadDevices();

// Pilihan awal yang masuk akal: kalau menu dibuka pakai stick, stick itu jadi milik P1,
// dan stick lain (kalau ada) jadi milik P2.
function defaultDevices(fromPad: number | null): void {
  const pads = listPads();
  const valid = (d: Device) =>
    d.kind === "kbd" ||
    (d.kind === "net" ? app.online === "host" : d.kind === "touch" ? touchCapable() : pads.some((g) => g.index === d.index));
  if (hadSavedDevices && valid(devices[0]) && valid(devices[1]) && !sameDevice(devices[0], devices[1])) {
    // Pilihan tersimpan masih berlaku. Tapi kalau menu dibuka pakai stick yang belum
    // dipakai siapa pun, stick itu diusulkan untuk P1: itu alat yang sedang dipegang.
    const holding: Device | null =
      fromPad !== null && pads.some((g) => g.index === fromPad) ? { kind: "pad", index: fromPad } : null;
    if (holding && !sameDevice(devices[0], holding) && !sameDevice(devices[1], holding)) devices[0] = holding;
    return;
  }
  hadSavedDevices = false;
  const first = fromPad !== null && pads.some((g) => g.index === fromPad) ? fromPad : null;
  // Di HP dan tablet, alat bawaan P1 adalah tombol di layar.
  const phone = window.matchMedia("(pointer: coarse)").matches;
  devices[0] = first !== null ? { kind: "pad", index: first } : phone ? { kind: "touch" } : { kind: "kbd", set: 0 };
  const other = pads.find((g) => g.index !== first);
  devices[1] = other ? { kind: "pad", index: other.index } : first !== null ? { kind: "kbd", set: 0 } : { kind: "kbd", set: 1 };
}

const devHelp = (d: Device) =>
  d.kind === "kbd"
    ? KEY_HELP[d.set]
    : d.kind === "net"
      ? "Main dari perangkatnya sendiri, lewat internet."
      : d.kind === "touch"
        ? "Stik di kiri layar untuk gerak, tombol aksi di kanan layar."
        : PAD_HELP;

// Tombol yang selalu terlihat dan bisa diklik atau di-tap; pintasan keyboard-nya ditulis di dalamnya.
const tapBtn = (cls: string, tap: string, label: string, key = "") =>
  `<span class="tapbtn ${cls}" data-tap="${tap}">${label}${key ? ` <kbd>${key}</kbd>` : ""}</span>`;
const backBtn = () => tapBtn("back", "Escape", "◂ KEMBALI", "Esc");

// Tamu online yang kursinya masih tercatat tapi orangnya sudah putus.
const guestGone = (d: SpecDevice) => d.kind === "net" && !net.guests.has(d.id);
const netOptions = (): Device[] =>
  app.online === "host" ? Array.from(net.guests.keys()).map((id): Device => ({ kind: "net", id })) : [];

function ctrlRows(): number {
  return app.humans === 2 ? 2 : 1;
}

// Baris penonton ada di bawah baris pemain, kecuali di mode latihan.
function ctrlTotal(): number {
  return ctrlRows() + (app.training ? 0 : 1);
}

const specHuman = (d: SpecDevice) => d.kind !== "none" && d.kind !== "auto";

function ctrlConflict(): boolean {
  if (guestGone(devices[0]) || (app.humans === 2 && guestGone(devices[1])) || guestGone(spectator.device)) return true;
  if (app.humans === 2 && sameDevice(devices[0], devices[1])) return true;
  // Penonton tidak boleh memakai alat yang sedang dipakai pemain.
  if (app.training || !specHuman(spectator.device)) return false;
  for (let i = 0; i < ctrlRows(); i++) if (sameDevice(devices[i], spectator.device)) return true;
  return false;
}

const SPEC_HELP: Record<SpecDevice["kind"], string> = {
  none: "Tidak ada penonton yang mengganggu.",
  auto: "Game yang melempar: kulit pisang atau sandal ke pemain yang sedang unggul.",
  mouse: "Gerakkan mouse untuk membidik · klik kiri kulit pisang · klik kanan sandal",
  kbd: "C B geser bidikan · V kulit pisang · Spasi sandal",
  pad: "D-pad/stick geser bidikan · □ kulit pisang · ✕ sandal",
  net: "Mengusili dari perangkatnya sendiri, lewat internet.",
  touch: "Stik di kiri layar geser bidikan · tombol PISANG dan SANDAL di kanan",
};

function setSecondPlayer(kind: "cpu" | "mate" | "foe"): void {
  app.humans = kind === "cpu" ? 1 : 2;
  app.mate = kind === "mate";
  app.ctrlRow = Math.min(app.ctrlRow, ctrlTotal() - 1);
  if (app.humans === 2 && sameDevice(devices[0], devices[1])) {
    const other = deviceOptions().find((o) => !sameDevice(o, devices[0]));
    if (other) devices[1] = other;
  }
  sfx.swing();
  renderControls();
}

function goControls(fromPad: number | null = null): void {
  setMode("controls");
  app.ctrlRow = 0;
  defaultDevices(fromPad);
  renderControls();
}

function cycleDevice(player: number, dir: number): void {
  if (player >= ctrlRows()) {
    const sopts = [...spectatorOptions(), ...netOptions()];
    const cur = Math.max(0, sopts.findIndex((o) => sameDevice(o, spectator.device) || (o.kind === spectator.device.kind && o.kind !== "kbd" && o.kind !== "pad")));
    spectator.device = sopts[(cur + dir + sopts.length) % sopts.length];
    sfx.swing();
    renderControls();
    return;
  }
  const opts = [...deviceOptions(), ...netOptions()];
  const at = Math.max(0, opts.findIndex((o) => sameDevice(o, devices[player])));
  devices[player] = opts[(at + dir + opts.length) % opts.length];
  sfx.swing();
  renderControls();
}

function confirmControls(): void {
  if (ctrlConflict()) {
    sfx.fault();
    return;
  }
  if (app.online !== "host") saveDevices(); // kursi online tidak disimpan
  hadSavedDevices = true;
  sfx.receivePerfect();
  goSelect();
}

function renderControls(): void {
  const rows = ctrlRows();
  const row = (i: number) => {
    const d = devices[i];
    const help = devHelp(d);
    const who = i === 0 ? "PEMAIN 1" : app.teamSize > 1 ? (app.mate ? "PEMAIN 2 · TEMAN SETIM" : "PEMAIN 2 · LAWAN") : "PEMAIN 2";
    return (
      `<div class="crow${app.ctrlRow === i ? " on" : ""}" style="--pc:${hex(CHARS[app.chars[i]].color)}" data-tap="ctrlrow:${i}">` +
      `<div class="cwho display">${who}</div>` +
      `<div class="cpick"><span class="carr" data-tap="ctrl:${i}:-1">◂</span>` +
      `<span class="cdev display">${deviceLabel(d)}</span>` +
      `<span class="carr" data-tap="ctrl:${i}:1">▸</span><i class="lamp" id="lamp${i}"></i></div>` +
      `<div class="chelp">${help}</div></div>`
    );
  };
  const sd = spectator.device;
  const specRow = app.training
    ? ""
    : `<div class="crow${app.ctrlRow === rows ? " on" : ""}" style="--pc:#ffd23f" data-tap="ctrlrow:${rows}">` +
      `<div class="cwho display">PENONTON USIL · PEMAIN KE-3</div>` +
      `<div class="cpick"><span class="carr" data-tap="ctrl:${rows}:-1">◂</span>` +
      `<span class="cdev display">${deviceLabel(sd)}</span>` +
      `<span class="carr" data-tap="ctrl:${rows}:1">▸</span><i class="lamp" id="lamp${rows}"></i></div>` +
      `<div class="chelp">${SPEC_HELP[sd.kind]}` +
      (specHuman(sd) ? `<br />Biar adil: maksimal 2 lemparan tersimpan, isi ulang 7 detik, dan harus gantian sisi.` : "") +
      `</div></div>`;
  // Host mabar online: kode room di atas daftar kursi.
  const room =
    app.online !== "host"
      ? ""
      : `<div class="room"><span class="rlabel display">KODE ROOM</span>` +
        (net.ready
          ? `<b class="rcode display">${net.code}</b><span class="tapbtn go" data-tap="copylink">${linkCopied ? "TERSALIN ✓" : "SALIN LINK"}</span>`
          : `<b class="rcode display">· · · ·</b>`) +
        `<div class="rsub">${
          roomError ||
          (net.ready
            ? `Teman buka situs ini, pilih GABUNG ROOM, lalu ketik kodenya. Tamu terhubung: ${net.guests.size}. ` +
              `Atur siapa duduk di mana di bawah ini.`
            : "Membuat room…")
        }</div></div>`;
  // Mode tim: orang kedua bisa tidak ada (CPU), jadi teman setim, atau jadi lawan.
  const chip = (label: string, on: boolean, tap: string) =>
    `<span class="chip${on ? " on" : ""}" data-tap="${tap}">${label}</span>`;
  const teamRow =
    app.teamSize === 1 || app.online !== "off"
      ? ""
      : `<div class="chips"><b class="display">TIM ${app.teamSize} LAWAN ${app.teamSize} · PEMAIN KEDUA</b>` +
        chip("CPU", app.humans === 1, "p2:cpu") +
        chip("TEMAN SETIM", app.humans === 2 && app.mate, "p2:mate") +
        chip("LAWAN", app.humans === 2 && !app.mate, "p2:foe") +
        `<small>Sisa pemain diisi CPU.${touchState.enabled ? "" : " <kbd>T</kbd> ganti"}</small></div>`;
  $("ctrlRows").innerHTML = room + teamRow + row(0) + (rows === 2 ? row(1) : "") + specRow;
  const pads = listPads().length;
  const anyGone = guestGone(devices[0]) || guestGone(devices[1]) || guestGone(spectator.device);
  $("ctrlNote").innerHTML = anyGone
    ? `<b class="bad">Ada tamu yang sudah putus. Ganti kursinya dulu.</b>`
    : ctrlConflict()
    ? `<b class="bad">Tiap orang harus memakai alat yang berbeda.</b>`
    : app.online === "host"
    ? `Kursi tamu bisa ditukar dengan ◂ ▸. Tamu tanpa kursi tetap bisa menonton.`
    : touchState.enabled
    ? `Ganti alat dengan ◂ ▸. Pakai stick? Tekan salah satu tombolnya sekali supaya terbaca.`
    : `${pads} stick terhubung. Tes alatmu dengan tombol smash atau lompat: lampunya menyala kalau benar.` +
      (pads === 0 ? "<br />Stick belum terbaca? Tekan salah satu tombolnya sekali." : "") +
      `<br /><kbd>W</kbd><kbd>S</kbd> pilih baris &nbsp;·&nbsp; <kbd>A</kbd><kbd>D</kbd> ganti alat`;
  $("ctrlHint").innerHTML = backBtn() + tapBtn("go", "Enter", "LANJUT · PILIH JAGOAN ▸", "Enter");
}

// Lampu tes diperbarui tiap frame; daftar stick digambar ulang kalau jumlahnya berubah.
let padCountShown = -1;
let roomShown = "";
let linkCopied = false;
function updateControlsLive(): void {
  if (app.mode !== "controls") return;
  const count = listPads().length;
  const roomNow = `${net.ready}:${net.code}:${net.guests.size}:${roomError}`;
  if (count !== padCountShown || roomNow !== roomShown) {
    padCountShown = count;
    roomShown = roomNow;
    renderControls();
  }
  for (let i = 0; i < ctrlRows(); i++) {
    document.getElementById(`lamp${i}`)?.classList.toggle("on", deviceActive(devices[i]));
  }
  document.getElementById(`lamp${ctrlRows()}`)?.classList.toggle("on", deviceActive(spectator.device));
}

function goSelect(): void {
  setMode("select");
  app.locked = [false, false];
  Object.assign(state, createState(app.chars));
  renderSelect();
}

const ARCADE_LEVELS = [0, 0, 1, 1, 2];
// Karakter terkunci hanya berlaku saat main sendiri di perangkat ini; online semua terbuka.
const canPick = (k: number) => app.online !== "off" || isUnlocked(k);

function startMatch(): void {
  if (app.arcade.on) {
    app.chars[1] = app.arcade.foes[app.arcade.stage] ?? app.chars[1];
    app.cpuLevel = ARCADE_LEVELS[app.arcade.stage] ?? 2;
  }
  Object.assign(state, createState(buildLineup()));
  renderer.humanSlots = app.humans === 2 ? [0, slotOf(1)] : [0];
  state.winScore = app.training ? 7 : app.winScore;
  state.winCap = state.winScore + 3;
  // Arena acak diundi tiap pertandingan baru; saat latihan dan online-tamu dibiarkan.
  if (!app.training) applyArena();
  if (!app.training && app.online !== "client" && !progress.arenas.includes(renderer.arena)) {
    progress.arenas.push(renderer.arena);
    saveProgress();
  }
  matchRecorded = false;
  resetShown();
  setMode("match");
  // Penonton: manusia (pemain ke-3), otomatis, atau tidak ada. Di latihan selalu tidak ada.
  const sd = app.training ? ({ kind: "none" } as SpecDevice) : spectator.device;
  // Tombol layar hanya tampil kalau ada kursi di perangkat ini yang memakainya.
  setTouchRole(
    devices[0].kind === "touch" || (app.humans === 2 && devices[1].kind === "touch")
      ? "player"
      : sd.kind === "touch"
        ? "spec"
        : "off",
  );
  state.spec.active = specHuman(sd);
  state.rowdy = sd.kind === "auto";
  if (app.training) {
    Object.assign(train, { smash: 0, smashPerfect: 0, recv: 0, recvPerfect: 0, streak: 0, best: 0 });
    trainRestart();
    renderTrain();
    if (app.tutorial) tutBegin(0);
  }
  // Petunjuk tombol mengikuti alat yang dipilih tiap pemain.
  const helpFor = (i: number) => {
    const d = devices[i];
    return `<b>P${i + 1} · ${deviceLabel(d)}</b> ${d.kind === "net" ? "" : devHelp(d)}`;
  };
  elHelp.innerHTML =
    (app.humans === 2 ? `${helpFor(0)}<br />${helpFor(1)}` : helpFor(0)) + " &nbsp;·&nbsp; <kbd>Esc</kbd> jeda";
  callout(app.arcade.on ? `BABAK ${app.arcade.stage + 1} DARI ${ARCADE_LEVELS.length}` : "MULAI!", "#ffd23f", true);
  if (app.arcade.on) voice("vo_mulai");
}

// Catat hasil pertandingan ke statistik, sekali per pertandingan.
let matchRecorded = false;
const counting = () => app.mode === "match" && !app.training && app.online !== "client";
function toast(text: string): void {
  toastQueue.push(text);
}
const toastQueue: string[] = [];
function recordMatch(winnerSide: number): void {
  if (matchRecorded || !counting()) return;
  matchRecorded = true;
  const before = CHARS.map((_, k) => isUnlocked(k));
  progress.matches++;
  if (winnerSide === 0) {
    progress.wins++;
    const name = CHARS[state.chars[0]].name;
    progress.winsByChar[name] = (progress.winsByChar[name] ?? 0) + 1;
    if (state.score[1] === 0) progress.shutouts++;
    if (state.players.length > 2) progress.teamWins++;
    if (app.arcade.on) {
      progress.arcadeBest = Math.max(progress.arcadeBest, app.arcade.stage + 1);
      if (app.arcade.stage === ARCADE_LEVELS.length - 1) progress.arcadeClears++;
    }
  }
  for (const a of checkAchievements()) toast(`PENCAPAIAN: ${a.name.toUpperCase()}`);
  CHARS.forEach((c, k) => {
    if (!before[k] && isUnlocked(k)) toast(`JAGOAN BARU TERBUKA: ${c.name.toUpperCase()}`);
  });
  saveProgress();
}

function renderMenus(): void {
  // data-tap membuat tiap pilihan bisa diklik atau di-tap.
  const item = (label: string, on: boolean, tap: string) =>
    `<div class="item${on ? " on" : ""}" data-tap="${tap}">${label}</div>`;
  $("titleMenu").innerHTML =
    `<div class="mrow big">` +
    item("MAIN · LAWAN CPU", app.titleIndex === 0, "title:0") +
    item("MABAR · 2 PEMAIN", app.titleIndex === 1, "title:1") +
    `</div><div class="mrow">` +
    item("TIM · 2 LAWAN 2", app.titleIndex === 7, "title:7") +
    item("TIM · 3 LAWAN 3", app.titleIndex === 8, "title:8") +
    item("ARCADE", app.titleIndex === 9, "title:9") +
    `</div><div class="mrow">` +
    item("ONLINE · BUAT ROOM", app.titleIndex === 3, "title:3") +
    item("ONLINE · GABUNG ROOM", app.titleIndex === 4, "title:4") +
    `</div><div class="mrow">` +
    item("TUTORIAL", app.titleIndex === 5, "title:5").replace('class="item', settings.tutorialDone ? 'class="item' : 'class="item new') +
    item("LATIHAN", app.titleIndex === 2, "title:2") +
    item("PROFIL", app.titleIndex === 10, "title:10") +
    item("PENGATURAN", app.titleIndex === 6, "title:6") +
    `</div>`;
  if (app.online === "client") {
    $("pauseMenu").innerHTML =
      item("LANJUT", app.pauseIndex === 0, "pause:0") + item("KELUAR ROOM", app.pauseIndex === 1, "pause:1");
    return;
  }
  $("pauseMenu").innerHTML =
    item("LANJUT MAIN", app.pauseIndex === 0, "pause:0") +
    item("ULANG PERTANDINGAN", app.pauseIndex === 1, "pause:1") +
    item("PILIH KARAKTER", app.pauseIndex === 2, "pause:2") +
    item("MENU UTAMA", app.pauseIndex === 3, "pause:3");
}

// Skala 0..1 untuk batang statistik, dari rentang nilai seluruh roster.
function statBar(key: "moveSpeed" | "jumpV" | "smashSpeed", value: number): number {
  const all = CHARS.map((c) => c[key]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return 0.25 + 0.75 * ((value - lo) / (hi - lo));
}

// Potret tiap karakter, digambar sekali dari model 3D-nya.
const portraits: string[] = CHARS.map((_, k) => renderer.portrait(k));
// Karakter yang punya model AI: potretnya digambar ulang begitu modelnya selesai dimuat.
CHARS.forEach((_, k) => {
  void loadAiBody(k).then((b) => {
    if (!b) return;
    portraits[k] = renderer.portrait(k);
    renderSelect();
  });
});

function renderSelect(): void {
  const cpu = app.humans === 1;
  $("selectOpts").innerHTML =
    app.online === "client" || app.training
      ? ""
      : `<span class="chip" data-tap="opt:arena"><kbd>1</kbd> ARENA: <b>${arenaName()}</b></span>` +
        `<span class="chip" data-tap="opt:time"><kbd>2</kbd> WAKTU: <b>${timeName()}</b></span>` +
        `<span class="chip" data-tap="opt:win"><kbd>3</kbd> MENANG DI: <b>${app.winScore} POIN</b></span>` +
        (app.teamSize > 1 ? `<span class="chip on">TIM ${app.teamSize} LAWAN ${app.teamSize}</span>` : "");
  $("roster").innerHTML = CHARS.map((c, k) => {
    const open = canPick(k);
    const cls = ["card2", app.chars[0] === k ? "p1" : "", app.chars[1] === k ? "p2" : "", open ? "" : "shut"].join(" ");
    return (
      `<div class="${cls}" data-tap="char:${k}"><span class="tag2 a display${app.locked[0] ? " ok" : ""}">P1</span>` +
      `<span class="tag2 b display${app.locked[1] ? " ok" : ""}">${cpu ? "CPU" : "P2"}</span>` +
      `<img class="pic" src="${portraits[k]}" alt="" draggable="false" /><div class="nm">${open ? c.name : `Menang ${unlockWins(k)}×`}</div></div>`
    );
  }).join("");

  for (let i = 0; i < 2; i++) {
    const c = CHARS[app.chars[i]];
    const el = $(`d${i + 1}`);
    const who =
      i === 0
        ? "PEMAIN 1"
        : cpu
          ? `<span data-tap="KeyW">CPU · ${CPU_NAMES[app.cpuLevel].toUpperCase()} ▸</span>`
          : "PEMAIN 2";
    // Tunjukkan alat yang dipakai tiap pemain, supaya jelas siapa memegang apa.
    const device =
      app.online === "client"
        ? app.seat === i
          ? `<div class="dev ok">INI KAMU</div>`
          : ""
        : cpu && i === 1
          ? ""
          : `<div class="dev ok">${deviceLabel(devices[i])}</div>`;
    const stat = (label: string, v: number) =>
      `<div class="stat">${label}<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
    el.style.setProperty("--pc", hex(c.color));
    el.classList.toggle("locked", app.locked[i]);
    el.innerHTML =
      `<span class="lock">SIAP!</span><div class="who">${who}</div><div class="nm">${c.name}</div>` +
      `<div class="role">${ROLES[app.chars[i] % ROLES.length]}</div>` +
      stat("Cepat", statBar("moveSpeed", c.moveSpeed)) +
      stat("Lompat", statBar("jumpV", c.jumpV)) +
      stat("Tenaga", statBar("smashSpeed", c.smashSpeed)) +
      `<div class="sp"><b>${c.specialName}</b>${SPECIAL_DESC[c.special]}</div>` +
      device;
    document.documentElement.style.setProperty(`--c${i + 1}`, hex(c.color));
  }

  if (app.online === "client") {
    const mine = app.seat === 0 || app.seat === 1;
    $("selectHint").innerHTML = !mine
      ? `<span class="waitnote">Kamu ${app.seat === 2 ? "penonton usil" : "menonton"}. Menunggu pemain memilih jagoan…</span>`
      : touchState.enabled
        ? tapBtn("go", "lock", "KUNCI JAGOANMU ✓")
        : `<span class="waitnote"><b>Kamu P${app.seat + 1}</b> · <kbd>A</kbd><kbd>D</kbd> pilih</span>` +
          tapBtn("go", "lock", "KUNCI JAGOANMU ✓", "F");
    return;
  }
  // Tombol besar yang selalu ada: kunci pilihan, dan MULAI begitu tinggal satu langkah.
  const lockKey = (i: number) => {
    const d = devices[i];
    return d.kind === "kbd" ? (d.set === 1 ? "K" : "F") : d.kind === "pad" ? "✕" : "";
  };
  if (cpu) {
    $("selectHint").innerHTML =
      backBtn() +
      (app.locked[0]
        ? tapBtn("go", "lockp:1", "MULAI ▸", lockKey(0))
        : tapBtn("go", "lockp:0", "KUNCI JAGOANMU ✓", lockKey(0)));
    return;
  }
  const open = [0, 1].filter((i) => !app.locked[i]);
  const mineOpen = open.filter((i) => devices[i].kind !== "net");
  $("selectHint").innerHTML =
    backBtn() +
    mineOpen
      .map((i) => tapBtn("go", `lockp:${i}`, open.length === 1 ? `P${i + 1} SIAP · MULAI ▸` : `P${i + 1} SIAP ✓`, lockKey(i)))
      .join("") +
    (open.length > 0 && mineOpen.length === 0 ? `<span class="waitnote">Menunggu tamu memilih jagoan…</span>` : "");
}

// Tap atau klik pada elemen ber-data-tap. Nilainya nama tombol keyboard, atau perintah khusus.
function chooser(): 0 | 1 {
  return app.locked[0] ? 1 : 0;
}
function handleTap(v: string): void {
  const [cmd, arg] = v.split(":");
  if (cmd === "title") {
    app.titleIndex = Number(arg);
    menuKey("Enter");
  } else if (cmd === "pause") {
    app.pauseIndex = Number(arg);
    menuKey("Enter");
  } else if (cmd === "p2") {
    setSecondPlayer(arg as "cpu" | "mate" | "foe");
  } else if (cmd === "opt") {
    cycleOption(arg as "arena" | "time" | "win");
  } else if (cmd === "set") {
    const [, row, dir] = v.split(":");
    app.setRow = Number(row);
    stepSetting(Number(row), Number(dir));
  } else if (cmd === "setrow") {
    app.setRow = Number(arg);
    renderSettings();
  } else if (cmd === "tutskip") {
    tutNext();
  } else if (cmd === "tutmenu") {
    goTitle();
  } else if (cmd === "tutplay") {
    tutPlay();
  } else if (cmd === "copylink") {
    const done = () => {
      linkCopied = true;
      renderControls();
      window.setTimeout(() => {
        linkCopied = false;
        if (app.mode === "controls") renderControls();
      }, 1500);
    };
    try {
      void navigator.clipboard.writeText(roomLink()).then(done, () => window.prompt("Salin link ini:", roomLink()));
    } catch {
      window.prompt("Salin link ini:", roomLink());
    }
  } else if (cmd === "join") {
    menuKey("Enter");
  } else if (cmd === "char" && app.online === "client") {
    sendToHost({ t: "cmd", c: "char", k: Number(arg) });
  } else if (cmd === "lock" && app.online === "client") {
    sendToHost({ t: "cmd", c: "lock" });
  } else if (cmd === "char") {
    // Tap kartu memilih karakter untuk yang sedang giliran; tap kartu yang sama mengunci.
    const who = chooser();
    if (app.locked[who] || devices[who].kind === "net") return;
    if (!canPick(Number(arg))) return sfx.fault();
    const k = Number(arg);
    if (app.chars[who] === k) return lockChar(who);
    app.chars[who] = k;
    state.chars[who] = k;
    sfx.swing();
    renderSelect();
  } else if (cmd === "ctrl") {
    const [, who, dir] = v.split(":");
    app.ctrlRow = Number(who);
    cycleDevice(Number(who), Number(dir));
  } else if (cmd === "ctrlrow") {
    app.ctrlRow = Number(arg);
    renderControls();
  } else if (cmd === "lockp") {
    const who = Number(arg) === 1 ? 1 : 0;
    if (app.humans === 1 || devices[who].kind !== "net") lockChar(who);
  } else if (cmd === "lock") {
    if (devices[chooser()].kind !== "net") lockChar(chooser());
  } else if (cmd === "drill") {
    menuKey(`Digit${Number(arg) + 1}`);
  } else {
    menuKey(v);
  }
}
document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tap]");
  if (el?.dataset.tap) handleTap(el.dataset.tap);
});

// ===== Pengaturan =====
loadSettings();
loadProgress();
// Pemain baru: sorotan menu mulai di Tutorial.
if (!settings.tutorialDone) app.titleIndex = 5;
function applySettings(): void {
  setBusLevel("music", settings.music);
  setBusLevel("sfx", settings.sfx);
  setBusLevel("voice", settings.voice);
  renderer.shakeScale = settings.calm ? 0.25 : 1;
  renderer.setLowGfx(settings.lowGfx);
  document.body.classList.toggle("calm", settings.calm);
  document.documentElement.style.setProperty("--ts", String([0.85, 1, 1.2][settings.touchSize]));
}
applySettings();

// Getaran: HP lewat navigator.vibrate, stick lewat motor getarnya.
function buzz(player: number, ms: number): void {
  if (!settings.vibrate) return;
  if (app.online === "client") {
    if (app.seat === player) navigator.vibrate?.(ms);
    return;
  }
  if (app.mode !== "match") return;
  if (player !== 0 && !(app.humans === 2 && player === slotOf(1))) return;
  const d: Device = devices[player === 0 ? 0 : 1];
  if (d.kind === "touch") navigator.vibrate?.(ms);
  else if (d.kind === "pad") {
    type Rumble = { playEffect?: (kind: string, opts: Record<string, number>) => Promise<unknown> };
    const pad = navigator.getGamepads?.()[d.index] as (Gamepad & { vibrationActuator?: Rumble }) | null | undefined;
    void pad?.vibrationActuator
      ?.playEffect?.("dual-rumble", { duration: ms * 3, strongMagnitude: 0.6, weakMagnitude: 0.4 })
      ?.catch(() => undefined);
  }
}

interface SettingRow {
  label: string;
  note?: string;
  value(): string;
  step(dir: number): void;
}
const pct = (v: number) => (v === 0 ? "MATI" : `${Math.round(v * 100)}%`);
const stepLevel = (v: number, dir: number) => Math.min(1, Math.max(0, Math.round((v + dir * 0.25) * 4) / 4));
function settingRows(): SettingRow[] {
  const rows: SettingRow[] = [
    { label: "Musik", value: () => pct(settings.music), step: (d) => (settings.music = stepLevel(settings.music, d)) },
    { label: "Efek suara", value: () => pct(settings.sfx), step: (d) => (settings.sfx = stepLevel(settings.sfx, d)) },
    { label: "Komentator", value: () => pct(settings.voice), step: (d) => (settings.voice = stepLevel(settings.voice, d)) },
    {
      label: "Getaran",
      note: "HP dan stick yang mendukung",
      value: () => (settings.vibrate ? "NYALA" : "MATI"),
      step: () => (settings.vibrate = !settings.vibrate),
    },
  ];
  if (touchCapable()) {
    rows.push({
      label: "Ukuran tombol layar",
      value: () => ["KECIL", "SEDANG", "BESAR"][settings.touchSize],
      step: (d) => (settings.touchSize = (settings.touchSize + d + 3) % 3),
    });
  }
  rows.push(
    {
      label: "Efek layar",
      note: "Guncangan dan kilatan",
      value: () => (settings.calm ? "DIKURANGI" : "PENUH"),
      step: () => (settings.calm = !settings.calm),
    },
    {
      label: "Grafis",
      note: "Hemat: lebih lancar di HP yang berat",
      value: () => (settings.lowGfx ? "HEMAT" : "TINGGI"),
      step: () => (settings.lowGfx = !settings.lowGfx),
    },
  );
  return rows;
}

function stepSetting(row: number, dir: number): void {
  const r = settingRows()[row];
  if (!r) return;
  r.step(dir);
  applySettings();
  saveSettings();
  if (r.label === "Komentator") voice("vo_mulai");
  else if (r.label === "Getaran" && settings.vibrate) navigator.vibrate?.(40);
  else sfx.smash(0);
  renderSettings();
}

function renderSettings(): void {
  $("setRows").innerHTML = settingRows()
    .map(
      (r, i) =>
        `<div class="srow${app.setRow === i ? " on" : ""}" data-tap="setrow:${i}">` +
        `<div class="slabel display">${r.label}${r.note ? `<small>${r.note}</small>` : ""}</div>` +
        `<span class="carr" data-tap="set:${i}:-1">◂</span><span class="sval display">${r.value()}</span>` +
        `<span class="carr" data-tap="set:${i}:1">▸</span></div>`,
    )
    .join("");
  $("setHint").innerHTML = backBtn();
}

function goProfile(): void {
  setMode("profile");
  const p = progress;
  const stat = (label: string, value: string | number) => `<div class="pstat"><b class="display">${value}</b>${label}</div>`;
  const rate = p.matches > 0 ? `${Math.round((p.wins / p.matches) * 100)}%` : "–";
  const fav = Object.entries(p.winsByChar).sort((a, b) => b[1] - a[1])[0];
  $("profBox").innerHTML =
    `<div class="pstats">` +
    stat("pertandingan", p.matches) +
    stat("menang", p.wins) +
    stat("tingkat menang", rate) +
    stat("smash sempurna", p.perfectSmash) +
    stat("terima sempurna", p.perfectReceive) +
    stat("jurus kena", p.specials) +
    stat("reli terpanjang", p.bestRally) +
    stat("babak arcade terjauh", `${p.arcadeBest}/${ARCADE_LEVELS.length}`) +
    `</div>` +
    `<div class="pfav">Jagoan andalan: <b>${fav ? `${fav[0]} (${fav[1]} menang)` : "belum ada"}</b> · ` +
    `Jagoan terbuka: <b>${CHARS.filter((_, k) => isUnlocked(k)).length}/${CHARS.length}</b> · ` +
    `Pencapaian: <b>${p.achievements.length}/${ACHIEVEMENTS.length}</b></div>` +
    `<div class="pach">` +
    ACHIEVEMENTS.map((a) => {
      const got = p.achievements.includes(a.id);
      const c = a.count?.(p);
      const prog = !got && c ? ` <i>${Math.min(c[0], c[1])}/${c[1]}</i>` : "";
      return `<div class="ach${got ? " got" : ""}"><b>${got ? "★" : "☆"} ${a.name}</b>${a.desc}${prog}</div>`;
    }).join("") +
    `</div>`;
  $("profHint").innerHTML = backBtn();
}

function goSettings(): void {
  setMode("settings");
  app.setRow = 0;
  renderSettings();
}

// ===== Tutorial =====
// Latihan terpandu: tiap langkah mengajarkan satu hal, lanjut sendiri begitu berhasil.
type TutAction = "move" | "jump" | "smash" | "guard" | "special";
function keyName(a: TutAction): string {
  const d = devices[0];
  if (d.kind === "touch") return { move: "stik di kiri layar", jump: "LOMPAT", smash: "SMASH", guard: "TERIMA", special: "JURUS" }[a];
  if (d.kind === "pad") return { move: "D-pad atau stik", jump: "✕", smash: "□", guard: "L1", special: "△" }[a];
  if (d.kind === "kbd" && d.set === 1) return { move: "← dan →", jump: "↑", smash: "K", guard: "O", special: ";" }[a];
  return { move: "A dan D", jump: "W", smash: "F", guard: "E", special: "H" }[a];
}

const TUT_STEPS: Array<{ title: string; need: number; drill: number; text: () => string }> = [
  { title: "GERAK", need: 2, drill: -1, text: () => `Geser ke kiri dan ke kanan pakai <b>${keyName("move")}</b>.` },
  { title: "LOMPAT", need: 2, drill: -1, text: () => `Lompat dua kali pakai <b>${keyName("jump")}</b>.` },
  {
    title: "SMASH",
    need: 3,
    drill: 0,
    text: () => `Dekati bola, lalu tekan <b>${keyName("smash")}</b> saat bola sudah dekat badan. Lompat dulu supaya lebih tajam.`,
  },
  {
    title: "SMASH SEMPURNA",
    need: 1,
    drill: 0,
    text: () =>
      `Tekan <b>${keyName("smash")}</b> tepat saat <b>cincin emas</b> muncul di badanmu: sesaat sebelum bola sampai. Smash sempurna jauh lebih kencang.`,
  },
  {
    title: "TERIMA",
    need: 2,
    drill: 1,
    text: () =>
      `Bola kencang tidak bisa di-smash. Tekan <b>${keyName("guard")}</b> saat <b>cincin biru</b> muncul untuk menahannya. Tangan tidak dipakai: ini takraw.`,
  },
  {
    title: "JURUS",
    need: 1,
    drill: 0,
    text: () => `Meter di bawah namamu penuh? Tekan <b>${keyName("special")}</b> saat bola di dekatmu untuk jurus andalan.`,
  },
];
const tut = { step: 0, count: 0, wait: 0, startX: 0, left: false, right: false };

function tutBegin(step: number): void {
  tut.step = step;
  tut.count = 0;
  tut.wait = 0;
  tut.left = false;
  tut.right = false;
  const def = TUT_STEPS[step];
  if (def) {
    train.drill = Math.max(0, def.drill);
    train.cue = true;
    train.infiniteMeter = step === 5;
    trainRestart();
    if (def.drill < 0) train.launchPending = false;
    if (step !== 5) state.players[0].meter = 0;
    tut.startX = state.players[0].x;
  } else {
    settings.tutorialDone = true;
    saveSettings();
    train.launchPending = false;
  }
  renderTut();
}

function tutNext(): void {
  if (tut.step < TUT_STEPS.length) tutBegin(tut.step + 1);
}

function tutProgress(n: number): void {
  const def = TUT_STEPS[tut.step];
  if (!def || tut.wait > 0) return;
  tut.count = Math.min(def.need, n);
  if (tut.count >= def.need) {
    tut.wait = 75;
    sfx.receivePerfect();
    callout("MANTAP!", "#ffd23f", true);
  }
  renderTut();
}

// Tiap frame simulasi: tahan bola di langkah tanpa bola, pantau gerak, dan pindah langkah.
function tutTick(): void {
  const def = TUT_STEPS[tut.step];
  if (!def || def.drill < 0) {
    if (state.phase === "serve") state.timer = 14;
  }
  if (tut.wait > 0 && --tut.wait === 0) return tutNext();
  if (tut.step === 0 && tut.wait === 0) {
    const x = state.players[0].x;
    if (x < tut.startX - 0.6) tut.left = true;
    if (x > tut.startX + 0.6) tut.right = true;
    const n = (tut.left ? 1 : 0) + (tut.right ? 1 : 0);
    if (n !== tut.count) tutProgress(n);
  }
}

function tutEvent(e: GameEvent): void {
  if (!("player" in e) || e.player !== 0) return;
  const s = tut.step;
  if (
    (s === 1 && e.type === "jump") ||
    (s === 2 && e.type === "smash") ||
    (s === 3 && e.type === "smash" && e.perfect) ||
    (s === 4 && e.type === "receive") ||
    (s === 5 && e.type === "specialHit")
  ) {
    tutProgress(tut.count + 1);
  }
}

function renderTut(): void {
  const def = TUT_STEPS[tut.step];
  if (!def) {
    $("tut").innerHTML =
      `<div class="tt display">TUTORIAL SELESAI!</div>` +
      `Kamu sudah tahu dasarnya. Sisanya dipelajari sambil main.<br />` +
      tapBtn("go", "tutplay", "MAIN LAWAN CPU ▸", "Enter") +
      tapBtn("back", "tutmenu", "MENU");
    return;
  }
  $("tut").innerHTML =
    `<div class="tt display">TUTORIAL ${tut.step + 1}/${TUT_STEPS.length} · ${def.title}</div>` +
    `<div>${def.text()}</div>` +
    `<div class="tp">${"●".repeat(tut.count)}${"○".repeat(def.need - tut.count)}</div>` +
    tapBtn("back", "tutskip", "LEWATI ▸", "Enter");
}

function startTutorial(): void {
  app.teamSize = 1;
  app.mate = false;
  app.humans = 1;
  app.training = true;
  app.tutorial = true;
  app.cpuLevel = 0;
  defaultDevices(menuPad);
  startMatch();
}

function tutPlay(): void {
  app.tutorial = false;
  app.training = false;
  app.humans = 1;
  app.cpuLevel = 0;
  startMatch();
}

// ===== Volume =====
// Satu tombol: penuh, setengah, bisu. Pengaturan lebih rinci menyusul di layar pengaturan.
const elVol = $("vol");
function showVolume(): void {
  const v = getVolume();
  elVol.dataset.v = v === 0 ? "0" : v < 1 ? "1" : "2";
  elVol.title = v === 0 ? "Suara: mati" : v < 1 ? "Suara: setengah" : "Suara: penuh";
}
elVol.addEventListener("click", () => {
  const at = VOLUME_STEPS.indexOf(getVolume());
  setVolume(VOLUME_STEPS[(at + 1) % VOLUME_STEPS.length]);
  showVolume();
  sfx.swing();
  elVol.blur();
});
showVolume();

// ===== Layar penuh =====
// Safari lama memakai nama berawalan webkit; iPhone tidak mendukungnya sama sekali,
// dan di sana tombolnya tidak ditampilkan.
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = Omit<HTMLElement, "requestFullscreen"> & {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
};
const fsDoc = document as FsDoc;
const fsRoot = document.documentElement as unknown as FsEl;
const elFs = $("fs");
const fsActive = () => Boolean(document.fullscreenElement ?? fsDoc.webkitFullscreenElement);

function toggleFullscreen(): void {
  if (fsActive()) {
    if (document.exitFullscreen) void document.exitFullscreen();
    else fsDoc.webkitExitFullscreen?.();
    return;
  }
  const request = fsRoot.requestFullscreen
    ? fsRoot.requestFullscreen()
    : Promise.resolve(fsRoot.webkitRequestFullscreen?.());
  // Di HP, kunci ke posisi mendatar kalau browser mengizinkan.
  void Promise.resolve(request)
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => undefined);
}

if (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen) {
  elFs.classList.add("can");
  elFs.addEventListener("click", () => {
    toggleFullscreen();
    elFs.blur(); // supaya spasi/Enter berikutnya tidak menekan tombol ini lagi
  });
  const sync = () => elFs.classList.toggle("on", fsActive());
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
}

// Seluruh HUD diperkecil di layar pendek atau sempit, supaya tidak saling tumpuk.
function fitUi(): void {
  const z = Math.max(0.42, Math.min(1, window.innerHeight / 640, window.innerWidth / 880));
  elHud.style.setProperty("zoom", String(z));
}
window.addEventListener("resize", fitUi);
fitUi();
initTouch({ onPause: () => menuKey("Escape") });

function moveChar(i: 0 | 1, d: number): void {
  if (app.locked[i]) return;
  let k = app.chars[i];
  // Karakter yang masih terkunci dilewati.
  for (let n = 0; n < CHARS.length; n++) {
    k = (k + d + CHARS.length) % CHARS.length;
    if (canPick(k)) break;
  }
  app.chars[i] = k;
  state.chars[i] = app.chars[i];
  sfx.swing();
  renderSelect();
}

function lockChar(i: 0 | 1): void {
  if (app.locked[i]) return;
  app.locked[i] = true;
  if (app.arcade.on && i === 0) {
    // Arcade: lima lawan acak yang berbeda dari jagoanmu.
    const pool = CHARS.map((_, k) => k).filter((k) => k !== app.chars[0]);
    app.arcade.foes = ARCADE_LEVELS.map(() => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    app.arcade.stage = 0;
    app.chars[1] = app.arcade.foes[0];
    state.chars[1] = app.chars[1];
    app.locked[1] = true;
  }
  sfx.receivePerfect();
  renderSelect();
  if (app.locked[0] && app.locked[1]) {
    window.setTimeout(() => {
      if (app.mode === "select" && app.locked[0] && app.locked[1]) startMatch();
    }, 550);
  }
}

// Aksi satu pemain di layar pilih karakter (dipakai keyboard dan stick).
function selectAct(player: 0 | 1, act: "left" | "right" | "lock"): void {
  if (act === "left") moveChar(player, -1);
  else if (act === "right") moveChar(player, 1);
  else lockChar(player);
}

// Stick yang terakhir dipakai menavigasi menu; jadi usulan alat untuk P1.
let menuPad: number | null = null;

const CONFIRM = new Set(["KeyF", "Enter", "Space"]);
const UP = new Set(["KeyW", "ArrowUp"]);
const DOWN = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);

function menuKey(code: string): void {
  if (app.mode === "title") {
    if (UP.has(code) || DOWN.has(code) || LEFT.has(code) || RIGHT.has(code)) {
      const at = TITLE_ORDER.indexOf(app.titleIndex);
      const n = TITLE_ORDER.length;
      app.titleIndex = TITLE_ORDER[(at + (DOWN.has(code) || RIGHT.has(code) ? 1 : n - 1)) % n];
      sfx.swing();
      renderMenus();
    } else if (CONFIRM.has(code) && app.titleIndex === 5) {
      sfx.receivePerfect();
      startTutorial();
    } else if (CONFIRM.has(code) && app.titleIndex === 6) {
      sfx.receivePerfect();
      goSettings();
    } else if (CONFIRM.has(code) && app.titleIndex === 10) {
      sfx.receivePerfect();
      goProfile();
    } else if (CONFIRM.has(code) && app.titleIndex === 3) {
      // Buat room: host mengatur kursi di layar pengaturan kontrol.
      app.teamSize = 1;
      app.mate = false;
      app.humans = 2;
      app.training = false;
      app.online = "host";
      roomError = "";
      sfx.receivePerfect();
      void hostRoom(hostHandlers);
      goControls(menuPad);
    } else if (CONFIRM.has(code) && app.titleIndex === 4) {
      sfx.receivePerfect();
      goJoin("");
    } else if (CONFIRM.has(code)) {
      app.humans = app.titleIndex === 1 ? 2 : 1;
      app.training = app.titleIndex === 2;
      app.teamSize = app.titleIndex === 7 ? 2 : app.titleIndex === 8 ? 3 : 1;
      app.mate = false;
      app.arcade.on = app.titleIndex === 9;
      app.arcade.stage = 0;
      sfx.receivePerfect();
      goControls(menuPad);
    }
    return;
  }

  if (app.mode === "profile") {
    if (code === "Escape" || code === "Backspace" || CONFIRM.has(code)) goTitle();
    return;
  }
  if (app.mode === "settings") {
    const rows = settingRows();
    if (code === "Escape" || code === "Backspace" || code === "Enter") return goTitle();
    if (UP.has(code) || DOWN.has(code)) {
      app.setRow = (app.setRow + (DOWN.has(code) ? 1 : rows.length - 1)) % rows.length;
      sfx.swing();
      renderSettings();
    } else if (LEFT.has(code)) stepSetting(app.setRow, -1);
    else if (RIGHT.has(code) || code === "KeyF" || code === "Space") stepSetting(app.setRow, 1);
    return;
  }

  if (app.mode === "join") {
    if (code === "Escape") return goTitle();
    if ((code === "Enter" || code === "NumpadEnter") && (join.status === "input" || join.status === "error")) {
      const el = document.getElementById("roomInput") as HTMLInputElement | null;
      const typed = cleanCode(el?.value ?? "");
      if (typed.length === 4) goJoin(typed);
      else sfx.fault();
    }
    return;
  }

  if (app.online === "client") {
    // Tamu: pilihannya dikirim ke host; menu jeda hanya berisi "keluar room".
    if (app.paused) {
      if (code === "Escape") {
        app.paused = false;
        elHud.dataset.paused = "0";
      } else if (UP.has(code) || DOWN.has(code)) {
        app.pauseIndex = 1 - app.pauseIndex;
        sfx.swing();
        renderMenus();
      } else if (CONFIRM.has(code)) {
        if (app.pauseIndex === 1) return goTitle();
        app.paused = false;
        elHud.dataset.paused = "0";
      }
    } else if (code === "Escape") {
      app.paused = true;
      app.pauseIndex = 0;
      elHud.dataset.paused = "1";
      renderMenus();
    } else if (app.mode === "select" && (app.seat === 0 || app.seat === 1)) {
      if (LEFT.has(code)) sendToHost({ t: "cmd", c: "left" });
      else if (RIGHT.has(code)) sendToHost({ t: "cmd", c: "right" });
      else if (CONFIRM.has(code) || code === "KeyK") sendToHost({ t: "cmd", c: "lock" });
    } else if (app.mode === "match" && state.phase === "over" && code === "KeyM") {
      goTitle();
    }
    return;
  }

  if (app.mode === "controls") {
    if (code === "Escape" || code === "Backspace") return goTitle();
    if (UP.has(code) || DOWN.has(code)) {
      app.ctrlRow = (app.ctrlRow + (DOWN.has(code) ? 1 : ctrlTotal() - 1)) % ctrlTotal();
      sfx.swing();
      renderControls();
    } else if (LEFT.has(code)) cycleDevice(app.ctrlRow, -1);
    else if (RIGHT.has(code)) cycleDevice(app.ctrlRow, 1);
    // Hanya Enter yang melanjutkan. Tombol aksi (F, K, dan lain-lain) sengaja tidak
    // dipakai di sini supaya bisa ditekan bebas untuk mengetes lampu.
    else if (code === "Enter" || code === "NumpadEnter") confirmControls();
    else if (code === "KeyT" && app.teamSize > 1 && app.online === "off") {
      setSecondPlayer(app.humans === 1 ? "mate" : app.mate ? "foe" : "cpu");
    }
    return;
  }

  if (app.mode === "select" && !app.training) {
    if (code === "Digit1") return cycleOption("arena");
    if (code === "Digit2") return cycleOption("time");
    if (code === "Digit3") return cycleOption("win");
  }
  if (app.mode === "select") {
    if (code === "Escape" || code === "Backspace") {
      // Mundur selangkah: buka kunci terakhir, atau kembali ke pengaturan kontrol.
      if (app.locked[1]) app.locked[1] = false;
      else if (app.locked[0]) app.locked[0] = false;
      else return goControls();
      renderSelect();
      return;
    }
    if (app.humans === 1) {
      // Satu pemain memilih dirinya dulu, lalu lawannya.
      const who: 0 | 1 = app.locked[0] ? 1 : 0;
      if (LEFT.has(code)) moveChar(who, -1);
      else if (RIGHT.has(code)) moveChar(who, 1);
      else if (CONFIRM.has(code)) lockChar(who);
      else if (UP.has(code) || DOWN.has(code)) {
        app.cpuLevel = (app.cpuLevel + (UP.has(code) ? 1 : 2)) % 3;
        sfx.swing();
        renderSelect();
      }
    } else {
      // Dua pemain: tiap set tombol keyboard hanya berlaku untuk pemain yang memilihnya.
      const owner = (set: 0 | 1): 0 | 1 | -1 =>
        devices[0].kind === "kbd" && devices[0].set === set ? 0 : devices[1].kind === "kbd" && devices[1].set === set ? 1 : -1;
      const a = owner(0);
      const b = owner(1);
      if (a >= 0) {
        if (code === "KeyA") selectAct(a as 0 | 1, "left");
        else if (code === "KeyD") selectAct(a as 0 | 1, "right");
        else if (code === "KeyF") selectAct(a as 0 | 1, "lock");
      }
      if (b >= 0) {
        if (code === "ArrowLeft") selectAct(b as 0 | 1, "left");
        else if (code === "ArrowRight") selectAct(b as 0 | 1, "right");
        else if (code === "KeyK") selectAct(b as 0 | 1, "lock");
      }
    }
    return;
  }

  // Pertandingan.
  if (state.phase === "over") {
    if (CONFIRM.has(code)) {
      if (app.arcade.on) {
        const won = state.score[0] > state.score[1];
        // Menang: lanjut ke lawan berikutnya. Kalah atau sudah tamat: mulai lagi dari babak 1.
        app.arcade.stage = won && app.arcade.stage < ARCADE_LEVELS.length - 1 ? app.arcade.stage + 1 : 0;
      }
      startMatch();
    } else if (code === "KeyC") {
      app.arcade.stage = 0;
      goSelect();
    }
    else if (code === "KeyM" || code === "Escape") goTitle();
    return;
  }
  if (!app.paused && app.tutorial) {
    if (code === "Enter" || code === "NumpadEnter") {
      if (tut.step >= TUT_STEPS.length) tutPlay();
      else tutNext();
    }
  } else if (!app.paused && app.training) {
    // Tombol khusus latihan.
    const digit = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(code);
    if (digit >= 0) {
      train.drill = digit;
      trainRestart();
      renderTrain();
    } else if (code === "KeyR") trainRestart();
    else if (code === "KeyN") {
      train.infiniteMeter = !train.infiniteMeter;
      renderTrain();
    } else if (code === "KeyB") {
      train.cue = !train.cue;
      renderTrain();
    }
  }
  if (!app.paused) {
    if (code === "Escape") {
      app.paused = true;
      app.pauseIndex = 0;
      elHud.dataset.paused = "1";
      renderMenus();
    }
    return;
  }
  if (code === "Escape") {
    app.paused = false;
    elHud.dataset.paused = "0";
  } else if (UP.has(code) || DOWN.has(code)) {
    app.pauseIndex = (app.pauseIndex + (DOWN.has(code) ? 1 : 3)) % 4;
    sfx.swing();
    renderMenus();
  } else if (CONFIRM.has(code)) {
    if (app.pauseIndex === 0) {
      app.paused = false;
      elHud.dataset.paused = "0";
    } else if (app.pauseIndex === 1) startMatch();
    else if (app.pauseIndex === 2) goSelect();
    else goTitle();
  }
}
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  menuPad = null; // menu sedang dijalankan dari keyboard, bukan stick
  menuKey(e.code);
});

// ===== Gamepad di menu =====
// Di pertandingan, gamepad dibaca langsung oleh input.ts. Di sini tombolnya diterjemahkan
// ke tombol keyboard yang sudah dipahami menu, hanya saat baru ditekan.
// Indeks tombol mengikuti pemetaan standar: 0 silang/A, 1 lingkaran/B, 3 segitiga/Y,
// 9 Options/Start, 12-15 D-pad.
const padPrev = new Map<number, number>();
function pollPads(): void {
  trackPads();
  updateControlsLive();

  for (const pad of listPads()) {
    const b = (n: number) => pad.buttons[n]?.pressed === true;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const now =
      (b(12) || ay < -0.6 ? 1 : 0) |
      (b(13) || ay > 0.6 ? 2 : 0) |
      (b(14) || ax < -0.6 ? 4 : 0) |
      (b(15) || ax > 0.6 ? 8 : 0) |
      (b(0) ? 16 : 0) |
      (b(1) ? 32 : 0) |
      (b(3) ? 64 : 0) |
      (b(9) ? 128 : 0);
    const hit = now & ~(padPrev.get(pad.index) ?? 0);
    padPrev.set(pad.index, now);
    if (hit === 0) continue;
    menuPad = pad.index;

    const playing = app.mode === "match" && !app.paused && state.phase !== "over";
    if (playing) {
      // Saat bermain hanya Options/Start yang berarti menu: jeda.
      if (hit & 128) menuKey("Escape");
      continue;
    }

    // Pilih karakter mode 2 pemain: stick hanya menggerakkan pilihan pemiliknya.
    if (app.mode === "select" && app.humans === 2 && app.online !== "client") {
      const owner = devices.findIndex((d) => d.kind === "pad" && d.index === pad.index);
      if (owner >= 0) {
        if (hit & 4) selectAct(owner as 0 | 1, "left");
        if (hit & 8) selectAct(owner as 0 | 1, "right");
        if (hit & 16) selectAct(owner as 0 | 1, "lock");
      }
      if (hit & (32 | 128)) menuKey("Escape");
      continue;
    }

    if (app.mode === "controls") {
      // Di pengaturan: D-pad mengubah pilihan, Options melanjutkan, lingkaran kembali.
      // Tombol aksi lain dibiarkan untuk mengetes lampu.
      if (hit & (1 | 2)) menuKey("KeyW");
      if (hit & 4) menuKey("KeyA");
      if (hit & 8) menuKey("KeyD");
      if (hit & 128) menuKey("Enter");
      else if (hit & 32) menuKey("Escape");
      continue;
    }

    if (hit & 1) menuKey("KeyW");
    if (hit & 2) menuKey("KeyS");
    if (hit & 4) menuKey("KeyA");
    if (hit & 8) menuKey("KeyD");
    if (hit & 16) menuKey("KeyF");
    if (state.phase === "over" && app.mode === "match") {
      if (hit & 64) menuKey("KeyC");
      if (hit & 32) menuKey("KeyM");
    } else if (hit & (32 | 128)) {
      menuKey("Escape");
    }
  }
}

// Memutar ulang animasi CSS: lepas kelas, paksa reflow, pasang lagi.
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Pengumuman yang punya suara komentator.
const CALLOUT_VOICE: Record<string, string> = {
  "MULAI!": "vo_mulai",
  "MATCH POINT!": "vo_matchpoint",
  "DEUCE!": "vo_deuce",
  "POIN PENENTUAN!": "vo_penentuan",
  "FAULT!": "vo_fault",
};

function callout(text: string, color: string, mini = false): void {
  const vo = CALLOUT_VOICE[text];
  if (vo) voice(vo);
  elCallout.textContent = text;
  elCallout.style.setProperty("--cc", color);
  elCallout.classList.toggle("mini", mini);
  replay(elCallout, "show");
}

function pop(text: string, player: number, color: string): void {
  elPop.textContent = text;
  elPop.style.setProperty("--pc", color);
  elPop.classList.toggle("left", sideOf(player) === 0);
  elPop.classList.toggle("right", sideOf(player) === 1);
  replay(elPop, "show");
}

const charOf = (player: number) => CHARS[state.chars[player]];

// Slow-motion: hanya memperlambat laju simulasi di layar, tidak mengubah hasilnya.
let slowScale = 1;
let slowUntil = 0;
function slowMo(scale: number, seconds: number): void {
  const until = performance.now() + seconds * 1000;
  if (performance.now() >= slowUntil || scale <= slowScale) slowScale = scale;
  slowUntil = Math.max(slowUntil, until);
}

// Ketegangan 0..1: reli panjang, bola panas, dan match point membuat penonton makin ramai.
function excitement(): number {
  if (state.phase !== "play") return state.phase === "over" ? 0.6 : 0.15;
  const mp = matchPointMask(state.score, state.winScore, state.winCap) !== 0 ? 0.3 : 0;
  return Math.min(1, state.rally / 24 + (Math.min(state.heat, HEAT_MAX) / HEAT_MAX) * 0.5 + mp);
}

const isMatchPoint = () => state.phase !== "over" && matchPointMask(state.score, state.winScore, state.winCap) !== 0;

// Ulti diaktifkan: layar meredup, garis kecepatan memancar dari pemain, nama jurus masuk.
function superCutin(player: number): void {
  const c = charOf(player);
  const color = hex(c.color);
  const fx = `${50 + (state.players[player].x / 9.4) * 50}%`;
  for (const el of [elDim, elLines]) {
    el.style.setProperty("--fx", fx);
    el.style.setProperty("--pc", color);
    replay(el, "show");
  }
  elCutin.innerHTML = `${c.specialName.toUpperCase()}<small>${c.name.toUpperCase()}</small>`;
  elCutin.style.setProperty("--pc", color);
  elCutin.classList.toggle("left", player === 0);
  elCutin.classList.toggle("right", player === 1);
  replay(elCutin, "show");
}

function flash(color: string): void {
  if (settings.calm) return;
  elFlash.style.setProperty("--pc", color);
  replay(elFlash, "show");
}

// Umpan balik timing di mode latihan. Mengembalikan true kalau event sudah ditangani penuh.
function trainEvent(e: GameEvent): boolean {
  if (e.type === "score") {
    // Tidak ada skor di latihan: langsung siapkan bola berikutnya.
    state.score = [0, 0];
    state.timer = 26;
    train.launchPending = true;
    sfx.bounce();
    return true;
  }
  if (e.type === "over") return true;
  // Di latihan terarah, begitu bolamu sampai ke lawan gilirannya selesai: bola baru dilepas.
  if (train.drill < 3 && "player" in e && e.player === 1 && (e.type === "touch" || e.type === "receive")) {
    trainRestart();
    return true;
  }
  if (!("player" in e) || e.player !== 0) return false;
  if (e.type === "smash") {
    train.smash++;
    if (e.perfect) train.smashPerfect++;
    trainResult(e.perfect);
    if (!e.perfect) {
      sfx.smash(0);
      const late = PERFECT_FROM - e.elapsed;
      const early = e.elapsed - PERFECT_TO;
      pop(late > 0 ? `TELAT ${late} FRAME` : `KECEPETAN ${early} FRAME`, 0, "#ff9a3d");
      return true;
    }
  } else if (e.type === "receive") {
    train.recv++;
    if (e.perfect) train.recvPerfect++;
    trainResult(e.perfect);
    if (!e.perfect) {
      sfx.receive();
      pop(`KECEPETAN ${e.elapsed - GUARD_PERFECT} FRAME`, 0, "#7fd4ff");
      return true;
    }
  } else if (e.type === "miss") {
    pop(
      e.kind === "smash" ? "MELESET · KECEPETAN" : e.kind === "special" ? "JURUS BATAL · METER UTUH" : "MELESET",
      0,
      "#b9aed6",
    );
    trainResult(false);
    return true;
  } else if (e.type === "touch" && e.weak) {
    trainResult(false);
  }
  return false;
}

// Pukulan terakhir di reli ini, untuk menilai apakah poinnya lahir dari blunder.
let lastHit: { player: number; weak: boolean } | null = null;

function handleEvent(e: GameEvent): void {
  // Di layar judul dan pilih karakter, simulasi hanya jadi tontonan: tanpa suara dan teks.
  if (app.mode !== "match") return;
  if (e.type === "touch") lastHit = { player: e.player, weak: e.weak };
  else if (e.type === "smash" || e.type === "receive" || e.type === "specialHit") {
    lastHit = { player: e.player, weak: false };
  }
  // Getaran untuk pemain yang bersangkutan.
  if (e.type === "smash") buzz(e.player, e.perfect ? 45 : 20);
  else if (e.type === "receive") buzz(e.player, e.perfect ? 35 : 15);
  else if (e.type === "specialHit") buzz(e.player, 80);
  else if (e.type === "slip") buzz(e.player, 90);
  else if (e.type === "bonk" && e.target === "player") buzz(e.player, 70);
  if (counting() && "player" in e && e.player === 0) {
    if (e.type === "smash" && e.perfect) progress.perfectSmash++;
    else if (e.type === "receive" && e.perfect) progress.perfectReceive++;
    else if (e.type === "specialHit") progress.specials++;
  }
  if (counting() && e.type === "score") progress.bestRally = Math.max(progress.bestRally, state.rally);
  if (e.type === "over") recordMatch(e.winner);
  if (app.tutorial) tutEvent(e);
  if (app.training && trainEvent(e)) return;
  switch (e.type) {
    case "touch":
      if (e.weak) {
        sfx.weak();
        sillySfx.slide();
        pop("KEWALAHAN!", e.player, "#b9aed6");
        crowdSfx.gasp();
      } else {
        sfx.touch();
      }
      break;
    case "guard":
      sfx.swing();
      break;
    case "receive":
      if (e.perfect) {
        sfx.receivePerfect();
        pop("TERIMA SEMPURNA!", e.player, "#bfeaff");
        crowdSfx.cheer(0.4);
        if (isMatchPoint()) slowMo(0.4, 0.35);
      } else {
        sfx.receive();
        pop("TERIMA!", e.player, "#7fd4ff");
      }
      break;
    case "smash":
      if (e.perfect) {
        sfx.perfect();
        pop("SEMPURNA!", e.player, "#ffd23f");
        flash("#fff6cf");
        crowdSfx.cheer(0.5);
        renderer.cheer(0.7);
        if (isMatchPoint()) slowMo(0.3, 0.45);
      } else if (isMatchPoint()) {
        sfx.smash(Math.min(state.heat, HEAT_MAX) / HEAT_MAX);
        pop("SMASH!", e.player, hex(charOf(e.player).color));
        slowMo(0.45, 0.3);
      } else {
        sfx.smash(Math.min(state.heat, HEAT_MAX) / HEAT_MAX);
        pop("SMASH!", e.player, hex(charOf(e.player).color));
      }
      break;
    case "bounce":
      sfx.bounce();
      break;
    case "jump":
      sfx.jump();
      break;
    case "dash":
      sfx.dash();
      break;
    case "whiff":
      sfx.swing();
      break;
    case "special":
      sfx.special();
      superCutin(e.player);
      break;
    case "specialHit":
      if (e.kind === "fire" || e.kind === "meteor") sfx.fire();
      else sfx.curve();
      flash(e.kind === "fire" || e.kind === "meteor" ? "#fff1c4" : "#e6f4ff");
      crowdSfx.cheer(0.7);
      renderer.cheer(0.8);
      break;
    case "curveDrop":
      sfx.curveDrop();
      break;
    case "score": {
      const loser = 1 - e.winner;
      // Blunder: yang kebobolan justru pemukul terakhir (bola nyangkut net atau jatuh di
      // lapangan sendiri), dan itu bukan karena kewalahan menahan bola keras.
      const blunder = !e.fault && lastHit !== null && lastHit.player === loser && !lastHit.weak;
      // Bengong: bola jatuh tanpa disentuh siapa pun sejak servis.
      const idle = !e.fault && lastHit === null;
      if (e.fault) {
        sfx.fault();
        sillySfx.trombone();
        callout("FAULT!", "#8a7fa8");
        crowdSfx.gasp();
      } else if (blunder || idle) {
        sillySfx.laugh();
        sillySfx.boing();
        callout(blunder ? "BLUNDER!" : "BENGONG!", "#ff4f6d");
        pop("HAHAHA!", e.winner, "#ffd23f");
      } else {
        sfx.score();
        callout(`POIN ${charOf(e.winner).name.toUpperCase()}!`, hex(charOf(e.winner).color));
        crowdSfx.cheer(1);
      }
      lastHit = null;
      renderer.cheer(1.4);
      // Poin penentu pertandingan: tayangan lambat.
      if (gameWinner(state.score[0], state.score[1]) >= 0) slowMo(0.22, 1.1);
      break;
    }
    case "heckle":
      sfx.swing();
      crowdSfx.cheer(0.3);
      pop(e.kind === "peel" ? "AWAS KULIT PISANG!" : "AWAS SANDAL!", e.side, "#ff4f6d");
      break;
    case "heckleDenied":
      // Umpan balik untuk penonton: kenapa lemparannya ditolak.
      specMessage(e.reason === "ammo" ? "ISI ULANG DULU" : e.reason === "side" ? "GANTIAN SISI!" : "JANGAN DI NET");
      break;
    case "slip":
      sillySfx.slide();
      sillySfx.laugh();
      pop("KEPLESET!", e.player, "#ffd23f");
      break;
    case "bonk":
      sillySfx.boing();
      if (e.target === "player") pop("ADUH!", e.player, "#7fd4ff");
      else pop("KENA SANDAL!", e.x < 0 ? 0 : 1, "#7fd4ff");
      break;
    case "miss":
      // Ayunan kosong: smash atau jurus yang tidak mengenai apa-apa.
      if (e.kind === "smash") sillySfx.boing();
      else if (e.kind === "special") pop("JURUS BATAL", e.player, "#b9aed6");
      break;
    case "over":
      sfx.over();
      window.setTimeout(() => voice("vo_menang"), 700);
      crowdSfx.cheer(1.6);
      renderer.cheer(4);
      // Menang tanpa kebobolan sama sekali: penonton menertawakan yang kalah.
      if (Math.min(state.score[0], state.score[1]) === 0) window.setTimeout(() => sillySfx.laugh(), 900);
      break;
    case "land":
      break;
  }
  if ((e.type === "touch" || e.type === "smash") && state.rally > 0 && state.rally % 10 === 0) {
    pop(`RALI ${state.rally}!`, e.player, "#ffd23f");
  }
}

function overTitle(w: number): string {
  if (app.arcade.on && w === 0 && app.arcade.stage === ARCADE_LEVELS.length - 1) return "JUARA ARCADE!";
  if (state.players.length > 2) return `TIM ${charOf(w).name.toUpperCase()} MENANG!`;
  return `${charOf(w).name.toUpperCase()} MENANG!`;
}
function againLabel(w: number): string {
  if (!app.arcade.on) return "MAIN LAGI ▸";
  if (w !== 0) return "COBA LAGI DARI BABAK 1 ▸";
  if (app.arcade.stage === ARCADE_LEVELS.length - 1) return "MAIN ARCADE LAGI ▸";
  return `LANJUT · BABAK ${app.arcade.stage + 2} ▸`;
}

// Panel kecil penonton: amunisi, sisi yang boleh diusili, dan pesan kalau lemparan ditolak.
const elSpec = $("spec");
let specMsg = "";
let specMsgUntil = 0;
function specMessage(text: string): void {
  specMsg = text;
  specMsgUntil = performance.now() + 900;
  sfx.fault();
}
let specShown = "";
function updateSpecPanel(): void {
  const sp = state.spec;
  elSpec.classList.toggle("on", sp.active);
  if (!sp.active) return;
  const full = Math.floor(sp.ammo);
  const pips = "●".repeat(full) + "○".repeat(SPEC_MAX_AMMO - full);
  const turn = sp.lastSide === 0 ? "GILIRAN KANAN ▸" : sp.lastSide === 1 ? "◂ GILIRAN KIRI" : "BEBAS PILIH SISI";
  const msg = performance.now() < specMsgUntil ? specMsg : turn;
  const html = `PENONTON <b>${pips}</b> <span>${msg}</span>`;
  if (html !== specShown) {
    specShown = html;
    elSpec.innerHTML = html;
  }
}

function updateHud(): void {
  updateSpecPanel();
  for (let i = 0; i < 2; i++) {
    const c = CHARS[state.chars[i]];
    const card = cards[i];

    if (shown.char[i] !== state.chars[i]) {
      shown.char[i] = state.chars[i];
      card.name.textContent = c.name;
      card.sp.textContent = `${state.players.length > 2 ? "KAPTEN" : `P${i + 1}`} · ${c.specialName}`;
      card.root.style.setProperty("--pc", hex(c.color));
      document.documentElement.style.setProperty(`--c${i + 1}`, hex(c.color));
    }

    if (shown.score[i] !== state.score[i]) {
      const first = shown.score[i] < 0;
      shown.score[i] = state.score[i];
      elScore[i].textContent = String(state.score[i]);
      if (!first && state.score[i] > 0) replay(elScore[i], "bump");
    }

    const meter = state.players[i].meter;
    const touchSeat = app.online === "client" ? app.seat : devices[1].kind === "touch" && app.humans === 2 ? 1 : 0;
    if (i === touchSeat) setSpecialReady(meter >= SPECIAL_COST);
    card.fill.style.width = `${(meter / METER_MAX) * 100}%`;
    card.meter.classList.toggle("ready", meter >= SPECIAL_COST);

    const used = state.lastSide === i ? Math.min(state.touches, MAX_TOUCHES) : 0;
    for (let k = 0; k < card.pips.length; k++) card.pips[k].classList.toggle("used", k < used);

    // Mode tim: teman setim tampil sebagai daftar kecil dengan meter jurusnya.
    let mates = "";
    for (let k = i + 2; k < state.players.length; k += 2) {
      const mc = CHARS[state.chars[k]];
      const pct = Math.round((state.players[k].meter / METER_MAX) * 20) * 5;
      const you = app.online === "off" && app.humans === 2 && k === slotOf(1) ? " · P2" : "";
      mates +=
        `<div class="mate${state.players[k].meter >= SPECIAL_COST ? " ready" : ""}" style="--pc:${hex(mc.color)}">` +
        `<span>${mc.name}${you}</span><i style="width:${pct}%"></i></div>`;
    }
    if (shown.mates[i] !== mates) {
      shown.mates[i] = mates;
      elMates[i].innerHTML = mates;
    }
  }

  if (shown.rally !== state.rally) {
    shown.rally = state.rally;
    elRally.textContent = `RALI ${state.rally}`;
    elRally.classList.toggle("on", state.rally >= 4);
    elRally.classList.toggle("hot", state.rally >= 10);
  }

  if (shown.heat !== state.heat) {
    const rising = state.heat > shown.heat;
    shown.heat = state.heat;
    elHeat.textContent = `PANAS ×${heatMul(state).toFixed(2)}`;
    elHeat.classList.toggle("on", state.heat >= 2);
    elHeat.classList.toggle("max", state.heat >= HEAT_MAX);
    elHeat.style.setProperty("--h", String(Math.min(state.heat, HEAT_MAX) / HEAT_MAX));
    if (rising && state.heat >= 2) replay(elHeat, "bump");
  }

  // Match point: label, bingkai merah berdenyut, dan pengumuman di awal servis.
  const mask = state.phase === "over" ? 0 : matchPointMask(state.score, state.winScore, state.winCap);
  if (shown.mp !== mask) {
    shown.mp = mask;
    elMp.classList.toggle("on", mask !== 0);
    elTension.classList.toggle("on", mask !== 0);
    if (app.mode === "match") music(mask !== 0 ? "music_tense" : "music_match");
    if (mask === 3) {
      elMp.textContent = "POIN PENENTUAN";
      elMp.style.setProperty("--pc", "#ffd23f");
    } else if (mask !== 0) {
      const who = mask === 1 ? 0 : 1;
      elMp.textContent = `MATCH POINT · ${charOf(who).name.toUpperCase()}`;
      elMp.style.setProperty("--pc", hex(charOf(who).color));
    }
  }
  if (shown.phase !== state.phase) {
    const from = shown.phase;
    shown.phase = state.phase;
    if (state.phase === "serve" && from === "point") {
      const [a, b] = state.score;
      if (mask === 3) callout("POIN PENENTUAN!", "#ffd23f", true);
      else if (mask !== 0) callout("MATCH POINT!", hex(charOf(mask === 1 ? 0 : 1).color), true);
      else if (a === b && a >= state.winScore - 1) callout("DEUCE!", "#8a7fa8", true);
    }
  }

  const over = state.phase === "over";
  if (shown.over !== over) {
    shown.over = over;
    elBanner.classList.toggle("on", over);
    elHud.dataset.over = over ? "1" : "0";
    if (over) {
      const w = state.score[0] > state.score[1] ? 0 : 1;
      elBanner.style.setProperty("--cc", hex(charOf(w).color));
      elBanner.innerHTML =
        `<div class="big display">${overTitle(w)}</div>` +
        `<div class="bscore display">${state.score[0]} – ${state.score[1]}</div>` +
        (app.online === "client"
          ? `<small>Menunggu host memilih: main lagi atau ganti jagoan…</small>` +
            `<div class="bbtns">${tapBtn("back", "KeyM", "KELUAR ROOM", "M")}</div>`
          : `<div class="bbtns">${tapBtn("go", "KeyF", againLabel(w), "F")}` +
            `${tapBtn("back", "KeyC", "GANTI JAGOAN", "C")}${tapBtn("back", "KeyM", "MENU UTAMA", "M")}</div>`) +
        `<small style="display:none"><span data-tap="KeyF"><kbd>F</kbd> main lagi</span> &nbsp;·&nbsp; ` +
        `<span data-tap="KeyC"><kbd>C</kbd> pilih karakter</span> &nbsp;·&nbsp; ` +
        `<span data-tap="KeyM"><kbd>M</kbd> menu utama</span></small>`;
    }
  }
}

// ===== Mabar online =====
// Host: tombol kursi online diambil dari tamu; keadaan game disiarkan tiap frame.
function seatInput(i: 0 | 1): number {
  const d = devices[i];
  return d.kind === "net" ? guestBits(d.id) : readInput(i);
}

let idleFrames = 0;
function hostBroadcast(events: GameEvent[]): void {
  if (net.guests.size === 0) return;
  const seatOf = (d: SpecDevice) => (d.kind === "net" ? d.id : 0);
  broadcast({
    t: "f",
    m: app.mode === "select" || app.mode === "match" ? app.mode : "lobby",
    p: app.paused,
    seats: [seatOf(devices[0]), seatOf(devices[1]), seatOf(spectator.device)],
    chars: app.chars,
    locked: app.locked,
    ar: [renderer.arena, renderer.time],
    s: app.mode === "select" || app.mode === "match" ? { ...state, events: [] } : undefined,
    ev: events,
  });
}

const seatByGuest = (id: number) => devices.findIndex((d) => d.kind === "net" && d.id === id);

const hostHandlers = {
  onJoin(id: number): void {
    const dev: Device = { kind: "net", id };
    // Kursi yang ditinggal tamu putus diisi dulu; di lobi, tamu pertama jadi P2 dan
    // berikutnya penonton. Host tetap bisa menukarnya.
    if (guestGone(devices[0])) devices[0] = dev;
    else if (guestGone(devices[1])) devices[1] = dev;
    else if (guestGone(spectator.device)) spectator.device = dev;
    else if (app.mode === "controls") {
      if (devices[1].kind !== "net") devices[1] = dev;
      else if (spectator.device.kind === "none" || spectator.device.kind === "auto") spectator.device = dev;
    }
    sfx.receivePerfect();
    setNetNote(`TAMU ${id} MASUK`, 2.5);
    if (app.mode === "controls") renderControls();
    else if (app.mode === "select") renderSelect();
  },
  onLeave(id: number): void {
    const seat = seatByGuest(id);
    setNetNote(`TAMU ${id} PUTUS`, 4);
    sfx.fault();
    if (app.mode === "controls") renderControls();
    else if (app.mode === "match" && seat >= 0 && state.phase !== "over" && !app.paused) {
      // Pemainnya hilang: jeda dulu. Kalau ia masuk lagi, kursinya otomatis kembali.
      app.paused = true;
      app.pauseIndex = 0;
      elHud.dataset.paused = "1";
      renderMenus();
    }
  },
  onCommand(id: number, cmd: GuestCommand): void {
    const seat = seatByGuest(id);
    if (app.mode !== "select" || seat < 0) return;
    const who = seat as 0 | 1;
    if (cmd.c === "char") {
      if (app.locked[who] || cmd.k < 0 || cmd.k >= CHARS.length) return;
      if (app.chars[who] === cmd.k) return lockChar(who);
      app.chars[who] = cmd.k;
      state.chars[who] = cmd.k;
      sfx.swing();
      renderSelect();
    } else selectAct(who, cmd.c);
  },
  onError(text: string): void {
    roomError = text;
  },
};

// ----- Tamu -----
function goJoin(code: string): void {
  setMode("join");
  if (code.length !== 4) {
    join.status = "input";
    join.text = "";
    renderJoin();
    return;
  }
  app.online = "client";
  app.seat = -1;
  app.teamSize = 1;
  app.mate = false;
  app.humans = 2;
  app.training = false;
  join.status = "connecting";
  join.text = code;
  renderJoin();
  const wasPlaying = () => net.myId >= 0;
  void joinRoom(code, {
    onClose(text) {
      // Putus di tengah jalan: coba sambung ulang beberapa kali sebelum menyerah. Host
      // mengembalikan kursimu begitu kamu masuk lagi.
      const dropped = text.startsWith("Sambungan ke host putus") && hadSeat;
      app.online = "off";
      app.seat = -1;
      mouse.capture = false;
      setNetNote("");
      setMode("join");
      startDemo();
      if (dropped && rejoinTries < 3) {
        rejoinTries++;
        join.status = "connecting";
        join.text = code;
        renderJoin();
        $("joinBox").innerHTML += `<br />Sambungan putus. Menyambung ulang (${rejoinTries}/3)…`;
        window.setTimeout(() => {
          if (app.mode === "join" && app.online === "off" && join.status === "connecting") goJoin(code);
        }, 1500);
        return;
      }
      rejoinTries = 0;
      join.status = "error";
      join.text = text;
      renderJoin();
    },
  });
  // Dicatat lewat pemeriksaan berkala: begitu host memberi nomor, sambungan ini dianggap pernah hidup.
  let hadSeat = false;
  const watch = window.setInterval(() => {
    if (app.online !== "client") return window.clearInterval(watch);
    if (wasPlaying()) {
      hadSeat = true;
      if (app.mode !== "join") rejoinTries = 0;
    }
  }, 500);
}

const SEAT_NAMES = ["PEMAIN 1", "PEMAIN 2", "PENONTON USIL"];
function renderJoin(): void {
  const back = backBtn();
  if (join.status === "input" || join.status === "error") {
    $("joinBox").innerHTML =
      `Ketik kode room dari host` +
      `<input id="roomInput" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" />` +
      `<span class="tapbtn go" data-tap="join">GABUNG ▸</span>` +
      (join.status === "error" ? `<br /><span class="bad">${join.text}</span>` : "");
    $("joinHint").innerHTML = back;
    if (!touchState.enabled) (document.getElementById("roomInput") as HTMLInputElement | null)?.focus();
    return;
  }
  if (join.status === "connecting") {
    $("joinBox").innerHTML = `<div class="jbig display">ROOM ${join.text}</div>Menyambung ke host…`;
  } else {
    const seat =
      app.seat >= 0
        ? `Kursimu: <b class="jbig display">${SEAT_NAMES[app.seat]}</b>`
        : `Kamu belum dapat kursi, jadi menonton dulu. Host bisa memberimu kursi.`;
    $("joinBox").innerHTML =
      `<div class="jbig display">TERHUBUNG · ROOM ${net.code}</div>${seat}<br />Menunggu host memulai…`;
  }
  $("joinHint").innerHTML = back;
}

interface FrameMsg {
  t: "f";
  m: "lobby" | "select" | "match";
  p: boolean;
  seats: number[];
  ar?: [ArenaId, TimeId];
  chars: [number, number];
  locked: [boolean, boolean];
  s?: GameState;
  ev: GameEvent[];
}

function clientHelp(): void {
  setTouchRole(app.seat === 2 ? "spec" : app.seat >= 0 ? "player" : "off");
  const text =
    app.seat === 2
      ? touchState.enabled
        ? "<b>KAMU PENONTON USIL</b> stik geser bidikan · SMASH kulit pisang · LOMPAT sandal"
        : "<b>KAMU PENONTON USIL</b> mouse membidik · klik kiri kulit pisang · klik kanan sandal (atau C B geser, V pisang, Spasi sandal)"
      : app.seat >= 0
        ? `<b>KAMU P${app.seat + 1}</b> ${KEY_HELP[0]}`
        : "<b>KAMU MENONTON</b>";
  elHelp.innerHTML = `${text} &nbsp;·&nbsp; <kbd>Esc</kbd> menu`;
}

function applyFrame(m: FrameMsg): void {
  if (
    Array.isArray(m.ar) &&
    ARENAS.some((a) => a.id === m.ar![0]) &&
    TIMES.some((t) => t.id === m.ar![1])
  ) {
    renderer.setArena(m.ar[0], m.ar[1]);
  }
  const seat = Array.isArray(m.seats) ? m.seats.indexOf(net.myId) : -1;
  const seatChanged = seat !== app.seat;
  app.seat = seat;
  const pickChanged =
    m.chars[0] !== app.chars[0] || m.chars[1] !== app.chars[1] || m.locked[0] !== app.locked[0] || m.locked[1] !== app.locked[1];
  app.chars = [m.chars[0] | 0, m.chars[1] | 0];
  app.locked = [m.locked[0] === true, m.locked[1] === true];
  let restarted = false;
  if (m.s) {
    restarted = m.s.frame < state.frame;
    Object.assign(state, m.s);
    state.events = [];
  }
  const want: Mode = m.m === "match" || m.m === "select" ? m.m : "join";
  if (want !== app.mode) {
    const wasPaused = app.paused;
    setMode(want);
    if (wasPaused && want !== "join") {
      app.paused = true;
      elHud.dataset.paused = "1";
    }
    if (want === "match") {
      resetShown();
      clientHelp();
      callout(app.seat === 2 ? "KAMU PENONTON USIL!" : app.seat >= 0 ? `KAMU P${app.seat + 1}!` : "MULAI!", "#ffd23f", true);
    } else if (want === "select") renderSelect();
    else {
      join.status = "waiting";
      renderJoin();
    }
  } else if (want === "match" && (restarted || seatChanged)) {
    if (restarted) resetShown();
    clientHelp();
  } else if (want === "select" && (pickChanged || seatChanged)) renderSelect();
  else if (want === "join" && seatChanged) renderJoin();
  hostPaused = m.p === true;
  if (app.mode === "match" && Array.isArray(m.ev)) {
    for (const e of m.ev) {
      handleEvent(e);
      renderer.handleEvent(e, state);
    }
  }
}

let hostPaused = false;
let clientAcc = 0;
let clientLast = performance.now();
let rejoinTries = 0;
let sentBits = -1;
let sentAim: number | null = null;
let sentAt = 0;
let keyAimAt = 0; // nilai mouse.moved saat bidikan terakhir digeser pakai tombol

function clientUpdate(now: number): void {
  if (net.ready && join.status === "connecting") {
    join.status = "waiting";
    renderJoin();
  }
  // Penyangga kecil: kiriman host sering datang bergerombol. Daripada menampilkan semuanya
  // sekaligus (gerakan jadi loncat-loncat), diputar satu per satu seirama 60 kali per detik,
  // dan baru dikejar kalau tumpukannya terlalu panjang.
  clientAcc = Math.min(0.1, clientAcc + Math.max(0, (now - clientLast) / 1000));
  clientLast = now;
  let budget = Math.floor(clientAcc / DT);
  clientAcc -= budget * DT;
  if (net.inbox.length > 6) budget = Math.max(budget, net.inbox.length - 2);
  if (app.mode !== "match") budget = net.inbox.length; // di menu tidak perlu dihaluskan
  while (budget-- > 0 && net.inbox.length > 0) {
    const m = net.inbox.shift() as FrameMsg;
    if (m.t !== "f" || !Array.isArray(m.chars) || !Array.isArray(m.locked)) continue;
    try {
      applyFrame(m);
    } catch {
      // pesan rusak: lewati, tunggu yang berikutnya
    }
  }

  // Kirim tombol ke host: tiap ada perubahan, plus kabar berkala supaya tidak dianggap putus.
  const spec = app.seat === 2;
  const playing = app.mode === "match" && app.seat >= 0 && !app.paused;
  mouse.capture = spec && playing;
  const bits = playing ? readAll(spec) : 0;
  let aim: number | null = null;
  if (spec && playing && !touchState.enabled) {
    if (bits & (Btn.LEFT | Btn.RIGHT)) keyAimAt = mouse.moved;
    if (mouse.moved !== keyAimAt) aim = Math.round(renderer.worldX(mouse.x, mouse.y) * 100) / 100;
  }
  if (net.ready && (bits !== sentBits || aim !== sentAim || now - sentAt > 500)) {
    sentBits = bits;
    sentAim = aim;
    sentAt = now;
    sendToHost(aim === null ? { t: "i", b: bits } : { t: "i", b: bits, x: aim });
  }

  if (net.ready && app.mode !== "join") {
    const stale = performance.now() - net.lastHeard > 1500;
    const note = stale ? "SAMBUNGAN TERSENDAT…" : hostPaused && app.mode === "match" ? "HOST MENJEDA" : "";
    if (elNetNote.textContent !== note) setNetNote(note);
  }

  const inMatch = app.mode === "match";
  const excite = inMatch ? excitement() : 0.12;
  crowdSfx.level(excite);
  if (inMatch) updateHud();
  renderer.draw(state, excite);
}

// Dipakai dari console untuk membekukan loop saat memeriksa pose.
const debug = { paused: false, manual: false }; // manual: loop hanya jalan lewat update() dari console

let last = performance.now();
let acc = 0;

// Satu putaran loop: simulasi sesuai waktu yang berlalu, lalu gambar.
// Dipisah dari penjadwalannya supaya bisa dijalankan manual saat pengujian.
function update(now: number): void {
  if (debug.paused) {
    acc = 0;
    last = now;
    return;
  }
  if (netNoteUntil > 0 && now > netNoteUntil) setNetNote("");
  if (toastQueue.length > 0 && elNetNote.textContent === "") {
    setNetNote(toastQueue.shift()!, 3.2);
    elNetNote.classList.add("good");
    sfx.receivePerfect();
  }
  if (app.online === "client") {
    last = now;
    acc = 0;
    clientUpdate(now);
    return;
  }
  const sent: GameEvent[] = [];
  let stepped = false;
  const inMatch = app.mode === "match";

  // Bola hampir jatuh di sisi yang akan kalah saat match point: detik-detik lambat.
  const mpMask = inMatch && isMatchPoint() ? matchPointMask(state.score, state.winScore, state.winCap) : 0;
  if (mpMask !== 0 && state.phase === "play" && state.ball.y < 1.5 && state.ball.vy < -3) {
    const losingSide = state.ball.x < 0 ? 0 : 1; // pemain yang kebobolan kalau bola jatuh di sini
    if (mpMask & (losingSide === 0 ? 2 : 1)) slowMo(0.4, 0.08);
  }
  const scale = inMatch && now < slowUntil ? slowScale : 1;
  if (now >= slowUntil) slowScale = 1;
  acc += Math.min(0.1, (now - last) / 1000) * (app.paused ? 0 : scale);
  last = now;
  while (acc >= DT) {
    let in0 = 0;
    let in1 = 0;
    let team: number[] | null = null; // input semua pemain di mode tim
    if (app.mode === "title") {
      // Demo: dua CPU bertanding; selesai satu pertandingan, mulai pasangan baru.
      in0 = cpuInput(state, 0, 2);
      in1 = cpuInput(state, 1, 2);
      if (state.phase === "over" && state.timer === 0) startDemo();
    } else if (app.mode === "select") {
      // Pratinjau: kedua karakter berdiri dekat net, bola diam di atasnya.
      state.phase = "serve";
      state.timer = 999;
      state.players[0].x = -2.1;
      state.players[1].x = 2.1;
      state.ball.x = 0;
      state.ball.y = 3.3;
    } else if (app.training) {
      if (app.tutorial) tutTick();
      // Latihan: bola dilepas begitu hitung mundur servis habis; lawan diam kecuali di "Bebas".
      if (state.phase === "serve" && state.timer > 14) state.timer = 14;
      if (state.phase === "serve" && state.timer <= 1 && train.launchPending) {
        train.launchPending = false;
        trainLaunch();
      }
      if (train.infiniteMeter) state.players[0].meter = 100;
      in0 = readInput(0);
      if (train.drill === 3) in1 = cpuInput(state, 1, app.cpuLevel);
      else if (train.forceSpecial > 0 && state.phase === "play") {
        train.forceSpecial--;
        in1 = train.forceSpecial === 1 ? 0 : 128; // lepas dulu, lalu tekan: butuh tepi naik
      }
    } else if (state.phase !== "over" && state.players.length > 2) {
      const second = app.humans === 2 ? slotOf(1) : -1;
      team = state.players.map((_, i) => (i === 0 ? seatInput(0) : i === second ? seatInput(1) : cpuInput(state, i, app.cpuLevel)));
    } else if (state.phase !== "over") {
      in0 = seatInput(0);
      in1 = app.humans === 2 ? seatInput(1) : cpuInput(state, 1, app.cpuLevel);
    }
    // Penonton manusia: bidikan mouse mengikuti kursor; alat lain menggesernya lewat tombol.
    let specIn = 0;
    if (inMatch && state.spec.active) {
      const sd = spectator.device;
      const lim = COURT_HALF - 0.7;
      if (sd.kind === "net") {
        specIn = guestBits(sd.id);
        const aim = guestAim(sd.id);
        if (aim !== null) state.spec.x = Math.min(lim, Math.max(-lim, aim));
      } else {
        specIn = readSpectator();
        if (sd.kind === "mouse") state.spec.x = Math.min(lim, Math.max(-lim, renderer.worldX(mouse.x, mouse.y)));
      }
    }
    step(state, team ?? [in0, in1], specIn);
    stepped = true;
    for (const e of state.events) {
      handleEvent(e);
      renderer.handleEvent(e, state);
      if (app.online === "host") sent.push(e);
    }
    // Tepuk tangan berirama saat reli memanas; temponya naik bersama panas.
    if (inMatch && state.phase === "play" && state.hitstop === 0 && state.heat >= 6) {
      const every = Math.round(34 - Math.min(state.heat, HEAT_MAX) * 0.75);
      if (state.frame % every === 0) crowdSfx.clap();
    }
    acc -= DT;
  }
  if (app.online === "host") {
    sweepGuests();
    if (stepped || ++idleFrames % 20 === 0) hostBroadcast(sent);
  }
  updateCue();
  const excite = inMatch ? excitement() : 0.12;
  crowdSfx.level(app.paused ? 0 : excite);
  if (inMatch) updateHud();
  renderer.draw(state, excite);
}

function frame(now: number): void {
  pollPads();
  if (!debug.manual) update(now);
  requestAnimationFrame(frame);
}
goTitle();
document.getElementById("boot")?.remove();

// Host online: browser menghentikan animasi saat tab disembunyikan, dan pertandingan ikut
// berhenti untuk semua tamu. Pekerja latar ini tetap berdetak, jadi simulasi dan kiriman ke
// tamu jalan terus walau host pindah tab.
try {
  const ticker = new Worker(URL.createObjectURL(new Blob(["setInterval(()=>postMessage(0),16)"], { type: "text/javascript" })));
  ticker.onmessage = () => {
    if (document.hidden && app.online === "host" && !debug.manual) update(performance.now());
  };
} catch {
  // tanpa pekerja latar: host harus tetap membuka tabnya
}
// Simpan game di perangkat (bisa dipasang ke layar utama dan dibuka tanpa internet).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
// Link undangan (?room=ABCD) langsung menyambung ke room.
const invited = cleanCode(new URLSearchParams(location.search).get("room") ?? "");
if (invited.length === 4) goJoin(invited);
requestAnimationFrame(frame);

// Untuk debugging dari console.
(window as unknown as { __game: unknown }).__game = {
  state,
  step,
  cpuInput,
  createState,
  renderer,
  debug,
  handleEvent,
  updateHud,
  app,
  train,
  update, // untuk menjalankan loop secara manual saat pengujian
  pollPads,
  menuKey,
  CHARS,
  net,
  devices,
  spectator,
};
