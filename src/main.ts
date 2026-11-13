import { crowdSfx, sfx, sillySfx } from "./audio";
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
import { initTouch, setSpecialReady, touchState } from "./touch";
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
  cpuInput,
  createState,
  DT,
  HEAT_MAX,
  heatMul,
  gameWinner,
  matchPointMask,
  MAX_TOUCHES,
  WIN_SCORE,
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

const shown = { score: [-1, -1], char: [-1, -1], rally: -1, heat: -1, over: false, mp: -1, phase: "" };

// ===== Alur aplikasi: judul -> pilih karakter -> pertandingan =====
type Mode = "title" | "join" | "controls" | "select" | "match";
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
}

function setMode(mode: Mode): void {
  app.mode = mode;
  app.paused = false;
  elHud.dataset.mode = mode;
  elHud.dataset.paused = "0";
  elHud.dataset.training = app.training && mode === "match" ? "1" : "0";
  renderer.cues[0] = null;
}

// Layar judul: pertandingan demo CPU lawan CPU berjalan di latar.
function startDemo(): void {
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
  elNetNote.textContent = text;
  elNetNote.classList.toggle("on", text !== "");
  netNoteUntil = seconds > 0 ? performance.now() + seconds * 1000 : 0;
}

function goTitle(): void {
  endOnline();
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
    d.kind === "kbd" || (d.kind === "net" ? app.online === "host" : pads.some((g) => g.index === d.index));
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
  devices[0] = first !== null ? { kind: "pad", index: first } : { kind: "kbd", set: 0 };
  const other = pads.find((g) => g.index !== first);
  devices[1] = other ? { kind: "pad", index: other.index } : first !== null ? { kind: "kbd", set: 0 } : { kind: "kbd", set: 1 };
}

const devHelp = (d: Device) =>
  d.kind === "kbd" ? KEY_HELP[d.set] : d.kind === "net" ? "Main dari perangkatnya sendiri, lewat internet." : PAD_HELP;

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

const specHuman = (d: SpecDevice) => d.kind === "mouse" || d.kind === "kbd" || d.kind === "pad" || d.kind === "net";

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
};

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
    const who = i === 0 ? "PEMAIN 1" : "PEMAIN 2";
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
  $("ctrlRows").innerHTML = room + row(0) + (rows === 2 ? row(1) : "") + specRow;
  const pads = listPads().length;
  const anyGone = guestGone(devices[0]) || guestGone(devices[1]) || guestGone(spectator.device);
  $("ctrlNote").innerHTML = anyGone
    ? `<b class="bad">Ada tamu yang sudah putus. Ganti kursinya dulu.</b>`
    : ctrlConflict()
    ? `<b class="bad">Tiap orang harus memakai alat yang berbeda.</b>`
    : app.online === "host"
    ? `Kursi tamu bisa ditukar dengan ◂ ▸. Tamu tanpa kursi tetap bisa menonton.`
    : `${pads} stick terhubung. Tes alatmu dengan tombol smash atau lompat: lampunya menyala kalau benar.` +
      (pads === 0 ? "<br />Stick belum terbaca? Tekan salah satu tombolnya sekali." : "");
  $("ctrlHint").innerHTML = touchState.enabled
    ? `<span class="tapbtn back" data-tap="Escape">◂ KEMBALI</span><span class="tapbtn go" data-tap="Enter">LANJUT ▸</span>`
    : `<kbd>W</kbd><kbd>S</kbd> pilih baris &nbsp;·&nbsp; <kbd>A</kbd><kbd>D</kbd> ganti alat &nbsp;·&nbsp; ` +
      `<kbd>Enter</kbd> atau <kbd>Options</kbd> lanjut &nbsp;·&nbsp; <kbd>Esc</kbd> kembali`;
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

function startMatch(): void {
  Object.assign(state, createState(app.chars));
  resetShown();
  setMode("match");
  // Penonton: manusia (pemain ke-3), otomatis, atau tidak ada. Di latihan selalu tidak ada.
  const sd = app.training ? ({ kind: "none" } as SpecDevice) : spectator.device;
  state.spec.active = specHuman(sd);
  state.rowdy = sd.kind === "auto";
  if (app.training) {
    Object.assign(train, { smash: 0, smashPerfect: 0, recv: 0, recvPerfect: 0, streak: 0, best: 0 });
    trainRestart();
    renderTrain();
  }
  // Petunjuk tombol mengikuti alat yang dipilih tiap pemain.
  const helpFor = (i: number) => {
    const d = devices[i];
    return `<b>P${i + 1} · ${deviceLabel(d)}</b> ${d.kind === "net" ? "" : devHelp(d)}`;
  };
  elHelp.innerHTML =
    (app.humans === 2 ? `${helpFor(0)}<br />${helpFor(1)}` : helpFor(0)) + " &nbsp;·&nbsp; <kbd>Esc</kbd> jeda";
  callout("MULAI!", "#ffd23f", true);
}

function renderMenus(): void {
  // data-tap membuat tiap pilihan bisa diklik atau di-tap.
  const item = (label: string, on: boolean, tap: string) =>
    `<div class="item${on ? " on" : ""}" data-tap="${tap}">${label}</div>`;
  $("titleMenu").innerHTML =
    item("1 PEMAIN · LAWAN CPU", app.titleIndex === 0, "title:0") +
    item("2 PEMAIN · MABAR", app.titleIndex === 1, "title:1") +
    item("LATIHAN", app.titleIndex === 2, "title:2") +
    `<div class="mrow">` +
    item("ONLINE · BUAT ROOM", app.titleIndex === 3, "title:3") +
    item("ONLINE · GABUNG ROOM", app.titleIndex === 4, "title:4") +
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

// Tombol memilih karakter untuk satu pemain, sesuai alat yang dipakainya.
function pickHelp(i: number): string {
  const d = devices[i];
  const keysHelp =
    d.kind === "net"
      ? "memilih dari perangkatnya"
      : d.kind === "pad"
      ? "D-pad pilih <kbd>✕</kbd> kunci"
      : d.set === 0
        ? "<kbd>A</kbd><kbd>D</kbd> pilih <kbd>F</kbd> kunci"
        : "<kbd>←</kbd><kbd>→</kbd> pilih <kbd>K</kbd> kunci";
  return `<b>P${i + 1}</b> ${keysHelp}`;
}

function renderSelect(): void {
  const cpu = app.humans === 1;
  $("roster").innerHTML = CHARS.map((c, k) => {
    const cls = ["card2", app.chars[0] === k ? "p1" : "", app.chars[1] === k ? "p2" : ""].join(" ");
    return (
      `<div class="${cls}" data-tap="char:${k}"><span class="tag2 a display${app.locked[0] ? " ok" : ""}">P1</span>` +
      `<span class="tag2 b display${app.locked[1] ? " ok" : ""}">${cpu ? "CPU" : "P2"}</span>` +
      `<span class="ico k${k}"></span><div class="nm">${c.name}</div></div>`
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
      ? `Kamu ${app.seat === 2 ? "penonton usil" : "menonton"}. Menunggu pemain memilih jagoan…`
      : touchState.enabled
        ? `<span class="tapbtn go" data-tap="lock">KUNCI JAGOANMU ✓</span>`
        : `<b>Kamu P${app.seat + 1}</b> <kbd>A</kbd><kbd>D</kbd> pilih &nbsp;·&nbsp; <kbd>F</kbd> kunci &nbsp;·&nbsp; <kbd>Esc</kbd> keluar room`;
    return;
  }
  if (touchState.enabled) {
    // Layar sentuh: tap kartu untuk memilih, lalu tombol besar untuk mengunci.
    const whoNow = app.locked[0] ? (cpu ? "LAWAN" : "P2") : cpu ? "JAGOANMU" : "P1";
    $("selectHint").innerHTML =
      `<span class="tapbtn back" data-tap="Escape">◂ KEMBALI</span>` +
      `<span class="tapbtn go" data-tap="lock">KUNCI ${whoNow} ✓</span>`;
    return;
  }
  $("selectHint").innerHTML = cpu
    ? `<kbd>A</kbd><kbd>D</kbd> pilih ${app.locked[0] ? "lawan" : "jagoanmu"} &nbsp;·&nbsp; <kbd>F</kbd> kunci &nbsp;·&nbsp; ` +
      `<kbd>W</kbd><kbd>S</kbd> tingkat CPU: <b>${CPU_NAMES[app.cpuLevel]}</b> &nbsp;·&nbsp; <kbd>Esc</kbd> kembali`
    : `${pickHelp(0)} &nbsp;·&nbsp; ${pickHelp(1)} &nbsp;·&nbsp; <kbd>Esc</kbd> kembali`;
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
  app.chars[i] = (app.chars[i] + d + CHARS.length) % CHARS.length;
  state.chars[i] = app.chars[i];
  sfx.swing();
  renderSelect();
}

function lockChar(i: 0 | 1): void {
  if (app.locked[i]) return;
  app.locked[i] = true;
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
    if (UP.has(code) || DOWN.has(code)) {
      app.titleIndex = (app.titleIndex + (DOWN.has(code) ? 1 : 4)) % 5;
      sfx.swing();
      renderMenus();
    } else if ((LEFT.has(code) || RIGHT.has(code)) && app.titleIndex >= 3) {
      app.titleIndex = app.titleIndex === 3 ? 4 : 3;
      sfx.swing();
      renderMenus();
    } else if (CONFIRM.has(code) && app.titleIndex === 3) {
      // Buat room: host mengatur kursi di layar pengaturan kontrol.
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
      sfx.receivePerfect();
      goControls(menuPad);
    }
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
    return;
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
    if (CONFIRM.has(code)) startMatch();
    else if (code === "KeyC") goSelect();
    else if (code === "KeyM" || code === "Escape") goTitle();
    return;
  }
  if (!app.paused && app.training) {
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

function callout(text: string, color: string, mini = false): void {
  elCallout.textContent = text;
  elCallout.style.setProperty("--cc", color);
  elCallout.classList.toggle("mini", mini);
  replay(elCallout, "show");
}

function pop(text: string, player: number, color: string): void {
  elPop.textContent = text;
  elPop.style.setProperty("--pc", color);
  elPop.classList.toggle("left", player === 0);
  elPop.classList.toggle("right", player === 1);
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
  const mp = matchPointMask(state.score) !== 0 ? 0.3 : 0;
  return Math.min(1, state.rally / 24 + (Math.min(state.heat, HEAT_MAX) / HEAT_MAX) * 0.5 + mp);
}

const isMatchPoint = () => state.phase !== "over" && matchPointMask(state.score) !== 0;

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
      card.sp.textContent = `P${i + 1} · ${c.specialName}`;
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
    if (i === (app.online === "client" && app.seat === 1 ? 1 : 0)) setSpecialReady(meter >= SPECIAL_COST);
    card.fill.style.width = `${(meter / METER_MAX) * 100}%`;
    card.meter.classList.toggle("ready", meter >= SPECIAL_COST);

    const used = state.lastSide === i ? Math.min(state.touches, MAX_TOUCHES) : 0;
    for (let k = 0; k < card.pips.length; k++) card.pips[k].classList.toggle("used", k < used);
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
  const mask = state.phase === "over" ? 0 : matchPointMask(state.score);
  if (shown.mp !== mask) {
    shown.mp = mask;
    elMp.classList.toggle("on", mask !== 0);
    elTension.classList.toggle("on", mask !== 0);
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
      else if (a === b && a >= WIN_SCORE - 1) callout("DEUCE!", "#8a7fa8", true);
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
        `<div class="big display">${charOf(w).name.toUpperCase()} MENANG!</div>` +
        (app.online === "client"
          ? `<small>Menunggu host… &nbsp;·&nbsp; <span data-tap="KeyM"><kbd>M</kbd> keluar room</span></small>`
          : "") +
        `<small${app.online === "client" ? ' style="display:none"' : ""}><span data-tap="KeyF"><kbd>F</kbd> main lagi</span> &nbsp;·&nbsp; ` +
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
  app.humans = 2;
  app.training = false;
  join.status = "connecting";
  join.text = code;
  renderJoin();
  void joinRoom(code, {
    onClose(text) {
      app.online = "off";
      app.seat = -1;
      mouse.capture = false;
      setNetNote("");
      setMode("join");
      startDemo();
      join.status = "error";
      join.text = text;
      renderJoin();
    },
  });
}

const SEAT_NAMES = ["PEMAIN 1", "PEMAIN 2", "PENONTON USIL"];
function renderJoin(): void {
  const back = touchState.enabled
    ? `<span class="tapbtn back" data-tap="Escape">◂ KEMBALI</span>`
    : `<kbd>Esc</kbd> kembali`;
  if (join.status === "input" || join.status === "error") {
    $("joinBox").innerHTML =
      `Ketik kode room dari host` +
      `<input id="roomInput" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" />` +
      `<span class="tapbtn go" data-tap="join">GABUNG ▸</span>` +
      (join.status === "error" ? `<br /><span class="bad">${join.text}</span>` : "");
    $("joinHint").innerHTML = touchState.enabled ? back : `<kbd>Enter</kbd> gabung &nbsp;·&nbsp; ${back}`;
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
  chars: [number, number];
  locked: [boolean, boolean];
  s?: GameState;
  ev: GameEvent[];
}

function clientHelp(): void {
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
let sentBits = -1;
let sentAim: number | null = null;
let sentAt = 0;
let keyAimAt = 0; // nilai mouse.moved saat bidikan terakhir digeser pakai tombol

function clientUpdate(now: number): void {
  if (net.ready && join.status === "connecting") {
    join.status = "waiting";
    renderJoin();
  }
  const frames = net.inbox.splice(0);
  for (const raw of frames) {
    const m = raw as FrameMsg;
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
  const mpMask = inMatch && isMatchPoint() ? matchPointMask(state.score) : 0;
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
    step(state, [in0, in1], specIn);
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
