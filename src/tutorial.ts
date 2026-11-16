// Tutorial: latihan terpandu langkah demi langkah.
import { sfx } from "./audio";
import { saveSettings, settings } from "./settings";
import { devices } from "./input";
import { type GameEvent } from "./sim";
import { $, app, callout, defaultDevices, menuPad, startMatch, state, tapBtn, train, trainRestart } from "./main";

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

export const TUT_STEPS: Array<{ title: string; need: number; drill: number; text: () => string }> = [
  { title: "GERAK", need: 2, drill: -1, text: () => `Geser ke kiri dan ke kanan pakai <b>${keyName("move")}</b>.` },
  { title: "LOMPAT", need: 2, drill: -1, text: () => `Lompat dua kali pakai <b>${keyName("jump")}</b>.` },
  {
    title: "SMASH",
    need: 3,
    drill: 0,
    text: () =>
      `Dekati bola, lalu tekan <b>${keyName("smash")}</b> saat bola sudah dekat badan. Kalau terus kamu <b>tahan</b>, kamu melayang sebentar: arahkan bola pakai <b>${keyName("move")}</b>, lalu lepas untuk menembak. Lompat dulu supaya lebih tajam.`,
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
export const tut = { step: 0, count: 0, wait: 0, startX: 0, left: false, right: false };

export function tutBegin(step: number): void {
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

export function tutNext(): void {
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
export function tutTick(): void {
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

export function tutEvent(e: GameEvent): void {
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

export function startTutorial(): void {
  app.teamSize = 1;
  app.mate = false;
  app.humans = 1;
  app.training = true;
  app.tutorial = true;
  app.cpuLevel = 0;
  defaultDevices(menuPad);
  startMatch();
}

export function tutPlay(): void {
  app.tutorial = false;
  app.training = false;
  app.humans = 1;
  app.cpuLevel = 0;
  startMatch();
}

