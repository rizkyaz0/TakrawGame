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

function readGamepad(i: number): number {
  const pad = navigator.getGamepads?.()[i];
  if (!pad) return 0;
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

export function readInput(i: 0 | 1): number {
  let out = readGamepad(i);
  for (const [code, bits] of KEYMAPS[i]) if (keys.has(code)) out |= bits;
  if (i === 0) out |= touchState.bits; // tombol sentuh selalu milik pemain 1
  return out;
}

export function onKey(code: string, fn: () => void): void {
  window.addEventListener("keydown", (e) => {
    if (e.code === code && !e.repeat) fn();
  });
}
