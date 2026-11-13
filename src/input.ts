import { Btn } from "./sim";
import { touchState } from "./touch";

const keys = new Set<string>();

const BLOCKED = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (BLOCKED.has(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

type KeyMap = Array<[string, number]>;

const KEYMAPS: [KeyMap, KeyMap] = [
  [
    ["KeyA", Btn.LEFT],
    ["KeyD", Btn.RIGHT],
    ["KeyW", Btn.UP | Btn.JUMP],
    ["KeyS", Btn.DOWN],
    ["KeyF", Btn.SMASH],
    ["KeyG", Btn.DASH],
    ["KeyH", Btn.SPECIAL],
    ["KeyE", Btn.GUARD],
  ],
  [
    ["ArrowLeft", Btn.LEFT],
    ["ArrowRight", Btn.RIGHT],
    ["ArrowUp", Btn.UP | Btn.JUMP],
    ["ArrowDown", Btn.DOWN],
    ["KeyK", Btn.SMASH],
    ["KeyL", Btn.DASH],
    ["Semicolon", Btn.SPECIAL],
    ["KeyO", Btn.GUARD],
  ],
];

// ===== Alat kontrol per pemain =====
// Tiap pemain memakai satu alat yang dipilih di layar pengaturan: salah satu dari dua
// set tombol keyboard, atau salah satu stick yang terhubung.
export type Device = { kind: "kbd"; set: 0 | 1 } | { kind: "pad"; index: number };

export const devices: [Device, Device] = [
  { kind: "kbd", set: 0 },
  { kind: "kbd", set: 1 },
];

const STORE_KEY = "takraw.devices";

export function saveDevices(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(devices));
  } catch {
    // penyimpanan diblokir: pilihan hanya berlaku untuk sesi ini
  }
}

export function loadDevices(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as unknown;
    if (!Array.isArray(raw) || raw.length !== 2) return false;
    for (let i = 0; i < 2; i++) {
      const d = raw[i] as Partial<Device> & { set?: number; index?: number };
      if (d.kind === "kbd" && (d.set === 0 || d.set === 1)) devices[i] = { kind: "kbd", set: d.set };
      else if (d.kind === "pad" && typeof d.index === "number") devices[i] = { kind: "pad", index: d.index };
      else return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sameDevice(a: Device, b: Device): boolean {
  if (a.kind === "kbd" && b.kind === "kbd") return a.set === b.set;
  if (a.kind === "pad" && b.kind === "pad") return a.index === b.index;
  return false;
}

// ----- Stick -----
// Di PC satu stick sering terbaca sebagai dua perangkat sekaligus (misalnya lewat
// DS4Windows atau Steam). Kembaran seperti itu selalu aktif bersamaan dengan aslinya
// dan tidak pernah aktif sendirian, jadi bisa dikenali dan disembunyikan dari daftar.
const together = new Map<string, number>();
const alone = new Map<number, number>();

function standardPads(): Gamepad[] {
  const all = Array.from(navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => g !== null);
  // Kalau ada perangkat berpemetaan standar, yang tidak standar diabaikan: itu biasanya
  // versi "mentah" dari stick yang sama, dengan letak tombol yang tidak bisa ditebak.
  const standard = all.filter((g) => g.mapping === "standard");
  return (standard.length > 0 ? standard : all).sort((a, b) => a.index - b.index);
}

function isActive(pad: Gamepad): boolean {
  if (pad.buttons.some((b) => b.pressed)) return true;
  return Math.abs(pad.axes[0] ?? 0) > 0.6 || Math.abs(pad.axes[1] ?? 0) > 0.6;
}

// Dipanggil tiap frame untuk mencatat stick mana yang aktif bersamaan.
export function trackPads(): void {
  const active = standardPads().filter(isActive);
  if (active.length === 1) alone.set(active[0].index, (alone.get(active[0].index) ?? 0) + 1);
  for (let a = 0; a < active.length; a++) {
    for (let b = a + 1; b < active.length; b++) {
      const key = `${active[a].index}-${active[b].index}`;
      together.set(key, (together.get(key) ?? 0) + 1);
    }
  }
}

// Daftar stick tanpa kembaran.
export function listPads(): Gamepad[] {
  const out: Gamepad[] = [];
  for (const pad of standardPads()) {
    const twin = out.some(
      // Cukup sekali terlihat aktif bersamaan: kalau menunggu lebih lama, tekanan pertama
      // dari stick kembaran sempat terhitung dua kali. Stick sungguhan akan muncul lagi
      // begitu ia aktif sendirian.
      (o) => (together.get(`${o.index}-${pad.index}`) ?? 0) >= 1 && (alone.get(pad.index) ?? 0) === 0,
    );
    if (!twin) out.push(pad);
  }
  return out;
}

function padByIndex(index: number): Gamepad | null {
  return standardPads().find((g) => g.index === index) ?? null;
}

export function deviceLabel(d: Device): string {
  if (d.kind === "kbd") return d.set === 0 ? "KEYBOARD · WASD" : "KEYBOARD · PANAH";
  const n = listPads().findIndex((g) => g.index === d.index);
  return n >= 0 ? `STICK ${n + 1}` : "STICK (TIDAK TERHUBUNG)";
}

// Semua pilihan alat yang tersedia saat ini.
export function deviceOptions(): Device[] {
  return [
    { kind: "kbd", set: 0 },
    { kind: "kbd", set: 1 },
    ...listPads().map((g): Device => ({ kind: "pad", index: g.index })),
  ];
}

function padBits(pad: Gamepad): number {
  let out = 0;
  const b = (n: number) => pad.buttons[n]?.pressed === true;
  const sx = pad.axes[0] ?? 0;
  const sy = pad.axes[1] ?? 0;
  if (sx < -0.4 || b(14)) out |= Btn.LEFT;
  if (sx > 0.4 || b(15)) out |= Btn.RIGHT;
  if (sy < -0.5 || b(12)) out |= Btn.UP;
  if (sy > 0.5 || b(13)) out |= Btn.DOWN;
  if (b(0)) out |= Btn.JUMP;
  if (b(2)) out |= Btn.SMASH;
  if (b(1) || b(5)) out |= Btn.DASH;
  if (b(3) || b(7)) out |= Btn.SPECIAL;
  if (b(4) || b(6)) out |= Btn.GUARD;
  return out;
}

function deviceBits(d: Device): number {
  if (d.kind === "kbd") {
    let out = 0;
    for (const [code, bits] of KEYMAPS[d.set]) if (keys.has(code)) out |= bits;
    return out;
  }
  const pad = padByIndex(d.index);
  return pad ? padBits(pad) : 0;
}

// Apakah alat ini sedang ditekan; dipakai untuk lampu tes di layar pengaturan.
export function deviceActive(d: Device): boolean {
  return deviceBits(d) !== 0;
}

export function readInput(i: 0 | 1): number {
  let out = deviceBits(devices[i]);
  if (i === 0) out |= touchState.bits; // tombol sentuh selalu milik pemain 1
  return out;
}
