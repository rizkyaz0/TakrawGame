import { Btn } from "./sim";

// Kontrol sentuh untuk HP dan tablet: joystick di kiri, tombol aksi di kanan.
// input.ts menggabungkan touchState.bits ke input pemain 1.

export const touchState = { bits: 0, enabled: false };

// Peran tombol layar di pertandingan: pemain (semua tombol), penonton usil (stik bidik
// dan dua lemparan), atau mati (tidak ada kursi lokal yang memakai tombol layar).
export type TouchRole = "off" | "player" | "spec";
let role: TouchRole = "player";

function applyRole(): void {
  document.body.dataset.trole = role;
  const label = (id: string, text: string) => {
    const el = document.querySelector<HTMLElement>(`[data-b="${id}"]`);
    if (el) el.textContent = text;
  };
  label("smash", role === "spec" ? "PISANG" : "SMASH");
  label("jump", role === "spec" ? "SANDAL" : "LOMPAT");
}

export function setTouchRole(r: TouchRole): void {
  role = r;
  applyRole();
}

// Layar ini bisa disentuh (HP, tablet, laptop layar sentuh).
export function touchCapable(): boolean {
  return touchState.enabled || (navigator.maxTouchPoints ?? 0) > 0;
}

interface TouchOptions {
  onPause(): void;
}

const BUTTONS: Array<{ id: string; label: string; bit: number }> = [
  { id: "smash", label: "SMASH", bit: Btn.SMASH },
  { id: "jump", label: "LOMPAT", bit: Btn.JUMP },
  { id: "guard", label: "TERIMA", bit: Btn.GUARD },
  { id: "dash", label: "DASH", bit: Btn.DASH },
  { id: "special", label: "JURUS", bit: Btn.SPECIAL },
];

// Mengunci jari ke elemen supaya geseran keluar tombol tetap terbaca. Sebagian browser
// menolak untuk pointer tertentu; kontrol tetap harus jalan tanpa itu.
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    // tidak apa-apa
  }
}

const STICK_RANGE = 46; // jarak geser maksimum kenop, dalam piksel
const DEAD_X = 14;
const DEAD_Y = 24;

let stickBits = 0;
let buttonBits = 0;

function sync(): void {
  touchState.bits = stickBits | buttonBits;
}

function build(opts: TouchOptions): void {
  const root = document.createElement("div");
  root.id = "touch";
  root.innerHTML =
    `<div id="tzone" class="ctl"><div id="tbase"><i id="tknob"></i></div></div>` +
    BUTTONS.map((b) => `<button class="tb ctl" data-b="${b.id}" type="button">${b.label}</button>`).join("") +
    `<button id="tpause" class="ctl" type="button" aria-label="Jeda">II</button>`;
  document.body.appendChild(root);

  // Tombol aksi: tiap tombol melacak jarinya sendiri, jadi bisa ditekan bersamaan.
  for (const def of BUTTONS) {
    const el = root.querySelector<HTMLElement>(`[data-b="${def.id}"]`)!;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      capture(el, e.pointerId);
      buttonBits |= def.bit;
      el.classList.add("on");
      sync();
    };
    const up = () => {
      buttonBits &= ~def.bit;
      el.classList.remove("on");
      sync();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }

  // Joystick mengambang: pusatnya muncul di titik pertama jari menyentuh area kiri.
  const zone = root.querySelector<HTMLElement>("#tzone")!;
  const base = root.querySelector<HTMLElement>("#tbase")!;
  const knob = root.querySelector<HTMLElement>("#tknob")!;
  let stickId = -1;
  let ox = 0;
  let oy = 0;

  const move = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RANGE) {
      dx = (dx / len) * STICK_RANGE;
      dy = (dy / len) * STICK_RANGE;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stickBits =
      (dx < -DEAD_X ? Btn.LEFT : 0) |
      (dx > DEAD_X ? Btn.RIGHT : 0) |
      (dy < -DEAD_Y ? Btn.UP : 0) |
      (dy > DEAD_Y ? Btn.DOWN : 0);
    sync();
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    stickBits = 0;
    base.classList.remove("on");
    knob.style.transform = "";
    sync();
  };
  zone.addEventListener("pointerdown", (e) => {
    if (stickId !== -1) return;
    e.preventDefault();
    capture(zone, e.pointerId);
    stickId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    const r = zone.getBoundingClientRect();
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    base.classList.add("on");
  });
  zone.addEventListener("pointermove", move);
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
  zone.addEventListener("lostpointercapture", end);

  root.querySelector<HTMLElement>("#tpause")!.addEventListener("click", () => opts.onPause());

  // Cegah menu konteks dan zoom ketuk-dua-kali saat bermain.
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  applyRole();
}

export function initTouch(opts: TouchOptions): void {
  const enable = () => {
    if (touchState.enabled) return;
    touchState.enabled = true;
    document.body.classList.add("touch");
    build(opts);
  };
  if (window.matchMedia("(pointer: coarse)").matches) enable();
  // Laptop layar sentuh: kontrol baru muncul setelah layar benar-benar disentuh.
  else window.addEventListener("touchstart", enable, { once: true, passive: true });
}

// Tombol jurus menyala saat meter cukup.
export function setSpecialReady(ready: boolean): void {
  document.querySelector('[data-b="special"]')?.classList.toggle("ready", ready);
}
