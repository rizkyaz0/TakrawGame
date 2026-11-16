// Lobi mabar offline (tahap 7): beberapa orang di satu perangkat. Tiap alat (keyboard WASD, keyboard panah,
// tiap stick, layar sentuh) bergabung sendiri dengan menekan tombol "siap"-nya, lalu memilih jagoan dan kursi
// secara serentak lewat tombolnya masing-masing. Pemain pertama yang bergabung jadi pemilik. Kursi kosong diisi bot.
import { sfx } from "./audio";
import { type Device, deviceLabel, keyFor, listPads, sameDevice, spectator } from "./input";
import { goTitle as goMenu } from "./main";
import { CHARS } from "./sim";
import { savedSkin } from "./skins";
import { touchState } from "./touch";
import { $, CPU_NAMES, app, arenaName, backBtn, cycleOption, elHelp, hex, lobbyPlan, portraits, setMode, startMatch, timeName } from "./main";
import { type LobbyView } from "./net";

const COLORS = ["#ffd23f", "#4cc9f0", "#7bd88f", "#ff8fab", "#c77dff", "#ff9f43"];
const COUNT_MS = 2000;

interface LP {
  pid: number;
  dev: Device;
  h: number; // jagoan, -1 belum
  r: boolean; // siap
  col: string;
}
const L = {
  on: false,
  fmt: 1 as 1 | 2 | 3,
  bots: true,
  parts: [] as LP[],
  seats: [null, null, null, null, null, null] as (number | null)[],
  owner: -1,
  focus: -1,
  next: 1,
  phase: "lobby" as "lobby" | "count",
  until: 0,
  msg: "",
};
export const localOn = (): boolean => L.on;
const part = (pid: number) => L.parts.find((p) => p.pid === pid);
const partOf = (d: Device) => L.parts.find((p) => sameDevice(p.dev, d));
const seatOf = (pid: number) => L.seats.indexOf(pid);

// Pemetaan ke bentuk keadaan lobi online, supaya ringkasan tim dan tes bisa dipakai bersama.
export function localView(): LobbyView {
  const info = (pid: number | null) => {
    const p = pid === null ? undefined : part(pid);
    return p ? { p: p.pid, h: p.h, r: p.r, n: deviceLabel(p.dev), o: true } : null;
  };
  return {
    fmt: L.fmt,
    bots: L.bots,
    quick: false,
    phase: L.phase,
    left: Math.max(0, L.until - performance.now()),
    until: L.until,
    host: L.owner,
    vis: "private",
    vote: { can: false, need: 0, votes: [] },
    seats: L.seats.map((p, k) => (k >= L.fmt * 2 ? null : info(p))),
    spec: [],
  };
}

export function goLocalLobby(team: 1 | 2 | 3): void {
  Object.assign(L, { on: true, fmt: team, bots: true, parts: [], seats: [null, null, null, null, null, null], owner: -1, focus: -1, next: 1, phase: "lobby", until: 0, msg: "" });
  lobbyPlan.on = false;
  app.online = "off";
  app.humans = 1;
  app.mate = false;
  app.training = false;
  app.arcade.on = false;
  setMode("lobby");
  renderLocal();
}
export function stopLocalLobby(): void {
  L.on = false;
  lobbyPlan.on = false;
  lobbyPlan.local = false;
}

// ----- Aksi -----
const teamHeroes = (seat: number, except: number): number[] => {
  const out: number[] = [];
  for (let k = seat & 1; k < L.fmt * 2; k += 2) {
    const o = L.seats[k];
    if (o !== null && o !== except) out.push(part(o)!.h);
  }
  return out;
};
const firstFree = (taken: number[], from: number): number => {
  for (let n = 0; n < CHARS.length; n++) {
    const k = (from + n) % CHARS.length;
    if (!taken.includes(k)) return k;
  }
  return -1;
};
const cancelCount = () => {
  if (L.phase === "count") {
    L.phase = "lobby";
    L.until = 0;
  }
};
function note(text: string): void {
  L.msg = text;
  sfx.fault();
}

function placeSeat(pid: number): boolean {
  const count = (t: number) => {
    let n = 0;
    for (let k = t; k < L.fmt * 2; k += 2) if (L.seats[k] !== null) n++;
    return n;
  };
  const first = count(0) <= count(1) ? 0 : 1;
  for (const team of [first, 1 - first]) {
    for (let k = team; k < L.fmt * 2; k += 2) {
      if (L.seats[k] === null) {
        L.seats[k] = pid;
        return true;
      }
    }
  }
  return false;
}

export function localJoin(dev: Device): void {
  if (partOf(dev)) return;
  if (L.parts.length >= L.fmt * 2) return note("Kursi penuh. Naikkan format dulu.");
  const p: LP = { pid: L.next++, dev, h: -1, r: false, col: COLORS[L.parts.length % COLORS.length] };
  L.parts.push(p);
  placeSeat(p.pid);
  p.h = firstFree(teamHeroes(seatOf(p.pid), p.pid), p.pid === 1 ? app.chars[0] : Math.floor(Math.random() * CHARS.length));
  if (L.owner < 0) L.owner = p.pid;
  L.focus = p.pid;
  cancelCount();
  L.msg = "";
  sfx.receivePerfect();
  renderLocal();
}
function localLeave(pid: number): void {
  L.parts = L.parts.filter((p) => p.pid !== pid);
  L.seats = L.seats.map((s) => (s === pid ? null : s));
  if (L.owner === pid) L.owner = L.parts[0]?.pid ?? -1;
  if (L.focus === pid) L.focus = L.parts[0]?.pid ?? -1;
  cancelCount();
  sfx.swing();
  renderLocal();
}
function setHero(pid: number, k: number): void {
  const p = part(pid);
  if (!p || L.phase !== "lobby") return note("Sedang hitung mundur.");
  if (teamHeroes(seatOf(pid), pid).includes(k)) return note("Jagoan itu sudah dipakai teman setim.");
  p.h = k;
  p.r = false;
  sfx.swing();
  renderLocal();
}
function cycleHero(pid: number, dir: number): void {
  const p = part(pid);
  if (!p) return;
  const taken = teamHeroes(seatOf(pid), pid);
  let k = p.h < 0 ? 0 : p.h;
  for (let i = 0; i < CHARS.length; i++) {
    k = (k + dir + CHARS.length) % CHARS.length;
    if (!taken.includes(k)) break;
  }
  setHero(pid, k);
}
function moveSeat(pid: number, dir: number): void {
  const p = part(pid);
  if (!p || L.phase !== "lobby") return;
  const n = L.fmt * 2;
  const at = seatOf(pid);
  for (let i = 1; i < n; i++) {
    const k = (at + dir * i + n * 2) % n;
    if (L.seats[k] === null) {
      L.seats[at] = null;
      L.seats[k] = pid;
      p.r = false;
      if (teamHeroes(k, pid).includes(p.h)) p.h = firstFree(teamHeroes(k, pid), p.h);
      sfx.swing();
      renderLocal();
      return;
    }
  }
}
function allReady(): boolean {
  return L.parts.length > 0 && L.parts.every((p) => p.r);
}
function toggleReady(pid: number): void {
  const p = part(pid);
  if (!p) return;
  if (L.phase === "count" && p.r) {
    p.r = false;
    cancelCount();
  } else p.r = !p.r;
  sfx.swing();
  renderLocal();
}
function start(): void {
  if (!allReady()) return note("Belum semua pemain siap.");
  if (!L.bots && L.parts.length < L.fmt * 2) return note("Bot dimatikan, jadi semua kursi harus diisi pemain.");
  L.phase = "count";
  L.until = performance.now() + COUNT_MS;
  L.msg = "";
  sfx.receivePerfect();
  renderLocal();
}
function setFmt(): void {
  const fmt = ((L.fmt % 3) + 1) as 1 | 2 | 3;
  if (L.parts.length > fmt * 2) return note("Pemain terlalu banyak untuk format itu.");
  const moved = L.seats.map((s, k) => (k >= fmt * 2 ? s : null)).filter((s): s is number => s !== null);
  L.fmt = fmt;
  L.seats = L.seats.map((s, k) => (k >= fmt * 2 ? null : s));
  for (const pid of moved) placeSeat(pid);
  for (const p of L.parts) {
    p.r = false;
    if (teamHeroes(seatOf(p.pid), p.pid).includes(p.h)) p.h = firstFree(teamHeroes(seatOf(p.pid), p.pid), p.h);
  }
  cancelCount();
  sfx.swing();
  renderLocal();
}
function ownerRule(what: string): void {
  if (what === "fmt") return setFmt();
  if (what === "bots") L.bots = !L.bots;
  else if (what === "cpu") app.cpuLevel = (app.cpuLevel + 1) % CPU_NAMES.length;
  else return cycleOption(what as "arena" | "time" | "win");
  sfx.swing();
  renderLocal();
}

// ----- Masukan -----
const sets = () =>
  ([0, 1] as const).map((set) => ({
    set,
    left: keyFor(set, "left"),
    right: keyFor(set, "right"),
    up: keyFor(set, "jump"),
    down: keyFor(set, "down"),
    ok: set === 0 ? [keyFor(0, "smash")] : [keyFor(1, "smash"), "Enter", "NumpadEnter"],
  }));

// Tombol "siap" yang ditekan pemilik saat semua sudah siap memulai pertandingan.
function okPressed(p: LP): void {
  if (p.pid === L.owner && p.r && L.phase === "lobby" && allReady()) start();
  else toggleReady(p.pid);
}

export function localKey(code: string): void {
  if (code === "Escape" || code === "Backspace") return goMenu();
  for (const k of sets()) {
    const dev: Device = { kind: "kbd", set: k.set };
    const p = partOf(dev);
    if (k.ok.includes(code)) {
      if (!p) localJoin(dev);
      else okPressed(p);
      return;
    }
    if (!p) continue;
    if (code === k.left) return cycleHero(p.pid, -1);
    if (code === k.right) return cycleHero(p.pid, 1);
    if (code === k.up) return moveSeat(p.pid, -1);
    if (code === k.down) return moveSeat(p.pid, 1);
  }
  // Aturan lewat angka: hanya bila pemilik memakai keyboard.
  const owner = part(L.owner);
  if (owner?.dev.kind === "kbd") {
    const rule: Record<string, string> = { Digit1: "fmt", Digit2: "bots", Digit3: "cpu", Digit4: "arena", Digit5: "time", Digit6: "win" };
    if (rule[code]) ownerRule(rule[code]);
  }
}

// Tombol stick (bitmask dari pollPads): 1 atas, 2 bawah, 4 kiri, 8 kanan, 16 silang, 32 lingkaran, 64 segitiga, 128 Options, 256 kotak.
export function localPad(index: number, hit: number): void {
  const dev: Device = { kind: "pad", index };
  const p = partOf(dev);
  if (!p) {
    if (hit & 16) localJoin(dev);
    return;
  }
  if (hit & 4) cycleHero(p.pid, -1);
  if (hit & 8) cycleHero(p.pid, 1);
  if (hit & 1) moveSeat(p.pid, -1);
  if (hit & 2) moveSeat(p.pid, 1);
  if (hit & 16) okPressed(p);
  if (hit & 32) {
    if (p.r) toggleReady(p.pid);
    else localLeave(p.pid);
  }
  if (p.pid === L.owner) {
    if (hit & 128) start();
    if (hit & 256) ownerRule("fmt");
    if (hit & 64) ownerRule("bots");
  }
}

export function localTap(v: string): void {
  const [, a, arg, arg2] = v.split(":");
  if (a === "join") {
    const dev: Device = arg === "kbd0" ? { kind: "kbd", set: 0 } : arg === "kbd1" ? { kind: "kbd", set: 1 } : arg === "touch" ? { kind: "touch" } : { kind: "pad", index: Number(arg2) };
    return localJoin(dev);
  }
  if (a === "focus") {
    L.focus = Number(arg);
    return renderLocal();
  }
  if (a === "drop") return localLeave(Number(arg));
  if (a === "hero") return setHero(L.focus, Number(arg));
  if (a === "ready") return toggleReady(L.focus);
  if (a === "start") return start();
  if (a === "bots" || a === "fmt" || a === "cpu" || a === "arena" || a === "time" || a === "win") return ownerRule(a);
}

// Dipanggil tiap frame: hitung mundur selesai, pertandingan dimulai.
export function localTick(now: number): void {
  if (L.phase === "count") {
    if (now >= L.until) startLocalMatch();
    else renderLocalSoft(now);
  }
}
let lastDraw = 0;
function renderLocalSoft(now: number): void {
  if (now - lastDraw > 250) {
    lastDraw = now;
    renderLocal();
  }
}

function startLocalMatch(): void {
  const n = L.fmt * 2;
  const pids = Array.from({ length: n }, (_, k) => L.seats[k] ?? -1);
  const chars = pids.map((p) => (p >= 0 ? part(p)!.h : -1));
  const used = new Set(chars.filter((c) => c >= 0));
  const free = CHARS.map((_, k) => k).filter((k) => !used.has(k));
  const skins = chars.map(() => 0);
  const dev: (Device | null)[] = pids.map((p) => (p >= 0 ? part(p)!.dev : null));
  for (let k = 0; k < n; k++) {
    if (pids[k] >= 0) skins[k] = savedSkin(chars[k]);
    else {
      chars[k] = free.splice(Math.floor(Math.random() * free.length), 1)[0] ?? k % CHARS.length;
      skins[k] = Math.floor(Math.random() * 3);
    }
  }
  Object.assign(lobbyPlan, { on: true, local: true, pids, host: -99, chars, skins, dev });
  L.phase = "lobby";
  L.until = 0;
  app.teamSize = L.fmt;
  app.humans = 1;
  app.mate = false;
  if (spectator.device.kind === "net") spectator.device = { kind: "none" };
  startMatch();
  const label = (d: Device) => (d.kind === "kbd" ? (d.set === 0 ? "WASD · F smash" : "PANAH · K smash") : deviceLabel(d));
  elHelp.innerHTML =
    pids
      .map((p, k) => (p >= 0 ? `<b>P${k + 1}</b> ${label(part(p)!.dev)}` : ""))
      .filter(Boolean)
      .join(" &nbsp;·&nbsp; ") + " &nbsp;·&nbsp; <kbd>Esc</kbd> jeda";
}

// Setelah pertandingan: kembali ke lobi dengan pilihan yang sama, siap dihapus.
export function localReturn(): void {
  lobbyPlan.on = false;
  lobbyPlan.local = false;
  for (const p of L.parts) p.r = false;
  L.phase = "lobby";
  L.on = true;
  setMode("lobby");
  renderLocal();
}

// ----- Tampilan -----
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderLocal(): void {
  $("lobbyTitle").textContent = `MABAR OFFLINE · ${L.fmt} LAWAN ${L.fmt}`;
  const n = L.fmt * 2;
  // Tombol gabung untuk alat yang belum dipakai (klik, atau tekan tombol siap alat itu).
  const joinChips: string[] = [];
  const addJoin = (label: string, dev: Device, tap: string) => {
    if (!partOf(dev)) joinChips.push(`<span class="chip" data-tap="${tap}">+ ${label}</span>`);
  };
  addJoin(`WASD <kbd>F</kbd>`, { kind: "kbd", set: 0 }, "lb:join:kbd0");
  addJoin(`PANAH <kbd>K</kbd>`, { kind: "kbd", set: 1 }, "lb:join:kbd1");
  listPads().forEach((g, i) => addJoin(`STIK ${i + 1} <kbd>✕</kbd>`, { kind: "pad", index: g.index }, `lb:join:pad:${g.index}`));
  if (touchState.enabled) addJoin("LAYAR SENTUH", { kind: "touch" }, "lb:join:touch");
  const chip = (label: string, value: string, tap: string, key = "") => `<span class="chip" data-tap="${tap}">${key ? `<kbd>${key}</kbd> ` : ""}${label}: <b>${value}</b></span>`;
  const rules =
    chip("FORMAT", `${L.fmt} LAWAN ${L.fmt}`, "lb:fmt", "1") +
    chip("KURSI KOSONG", L.bots ? "BOT" : "TETAP KOSONG", "lb:bots", "2") +
    chip("BOT", CPU_NAMES[app.cpuLevel].toUpperCase(), "lb:cpu", "3") +
    chip("ARENA", arenaName(), "lb:arena", "4") +
    chip("WAKTU", timeName(), "lb:time", "5") +
    chip("MENANG DI", `${app.winScore} POIN`, "lb:win", "6");
  const card = (k: number): string => {
    const pid = L.seats[k];
    const team = k & 1 ? "b" : "r";
    const p = pid === null ? undefined : part(pid);
    if (!p) return `<div class="lbseat ${team} empty"><div class="lbpic empty">?</div><div class="lbinfo"><b class="display">${L.bots ? "BOT" : "KOSONG"}</b><small>${L.bots ? "diisi bot saat mulai" : "menunggu pemain"}</small></div></div>`;
    const c = p.h >= 0 ? CHARS[p.h] : null;
    return (
      `<div class="lbseat ${team}${p.pid === L.focus ? " me" : ""}${p.r ? " ready" : ""}" style="--pc:${c ? hex(c.color) : "#888"}; --me:${p.col}" data-tap="lb:focus:${p.pid}">` +
      `<div class="lbpic">${c ? `<img src="${portraits[p.h]}" alt="" draggable="false" />` : "?"}</div>` +
      `<div class="lbinfo"><b class="display" style="color:${p.col}">PEMAIN ${p.pid}${p.pid === L.owner ? " ★" : ""}</b><small>${c ? c.name : "memilih…"} · ${esc(deviceLabel(p.dev))}</small>` +
      `<span class="lbst">${p.r ? "SIAP ✓" : "belum siap"}</span></div><span class="lbkick" data-tap="lb:drop:${p.pid}" title="Keluar">✕</span></div>`
    );
  };
  const col = (t: 0 | 1) =>
    `<div class="lbteam ${t ? "b" : "r"}"><div class="lbth display">${t ? "TIM BIRU" : "TIM MERAH"}</div>` +
    Array.from({ length: n }, (_, k) => k).filter((k) => (k & 1) === t).map(card).join("") +
    `</div>`;
  const focus = part(L.focus);
  const taken = focus ? teamHeroes(seatOf(focus.pid), focus.pid) : [];
  const grid = focus
    ? `<div class="lbgrid">` +
      CHARS.map((c, k) => {
        const dots = L.parts.filter((p) => p.h === k).map((p) => `<i class="lbdot" style="background:${p.col}"></i>`).join("");
        const off = taken.includes(k);
        return `<div class="lbcell${k === focus.h ? " cur" : ""}${off ? " shut" : ""}" style="--pc:${hex(c.color)}"${off ? "" : ` data-tap="lb:hero:${k}"`}><img src="${portraits[k]}" alt="" draggable="false" /><span>${c.name}</span><span class="lbdots">${dots}</span></div>`;
      }).join("") +
      `</div>`
    : `<div class="lbnote">Belum ada pemain. Tekan tombol siap alatmu (WASD: <kbd>F</kbd> · PANAH: <kbd>K</kbd> atau <kbd>Enter</kbd> · stik: ✕) atau ketuk salah satu tombol +.</div>`;
  const left = L.phase === "count" ? Math.max(0, Math.ceil((L.until - performance.now()) / 1000)) : 0;
  const status = L.phase === "count" ? `<div class="lbcount display">MULAI DALAM ${left}…</div>` : L.msg ? `<div class="lbnack">${esc(L.msg)}</div>` : "";
  const help = `<div class="lbnote">WASD: <kbd>A</kbd><kbd>D</kbd> jagoan · <kbd>W</kbd><kbd>S</kbd> kursi · <kbd>F</kbd> siap &nbsp;|&nbsp; PANAH: <kbd>←</kbd><kbd>→</kbd> jagoan · <kbd>↑</kbd><kbd>↓</kbd> kursi · <kbd>K</kbd> siap &nbsp;|&nbsp; stik: D-pad · ✕ siap · ○ keluar. Pemilik (★) menekan siap sekali lagi untuk MULAI.</div>`;
  $("lobbyBody").innerHTML =
    `<div class="lbtop"><div class="lbrules">${joinChips.join("")}</div></div><div class="lbtop"><div class="lbrules">${rules}</div></div>` +
    `<div class="lbteams">${col(0)}${col(1)}</div>${status}${grid}${help}`;
  const ready = !!focus?.r;
  $("lobbyHint").innerHTML =
    backBtn() +
    `<span class="tapbtn${ready ? "" : " go"}${focus && focus.h >= 0 ? "" : " off"}" data-tap="lb:ready">${ready ? "BATAL SIAP" : "SIAP ▸"}</span>` +
    `<span class="tapbtn go${L.phase === "lobby" && L.parts.length ? "" : " off"}" data-tap="lb:start">MULAI ▸</span>`;
}
