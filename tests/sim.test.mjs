// Tes inti simulasi. Jalankan dengan `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Btn,
  CHARS,
  SPECIAL_COST,
  cpuInput,
  createState,
  gameWinner,
  homeX,
  matchPointMask,
  sideOf,
  step,
} from "../src/sim.ts";

function runCpu(chars, frames, level = 1) {
  const s = createState(chars);
  for (let f = 0; f < frames && s.phase !== "over"; f++) {
    step(s, chars.map((_, i) => cpuInput(s, i, level)));
  }
  return s;
}

test("aturan menang: 7 poin, unggul 2, batas 10", () => {
  assert.equal(gameWinner(7, 5), 0);
  assert.equal(gameWinner(7, 6), -1);
  assert.equal(gameWinner(8, 6), 0);
  assert.equal(gameWinner(9, 10), 1);
  assert.equal(gameWinner(6, 6), -1);
  assert.equal(gameWinner(11, 9, 11, 14), 0);
  assert.equal(gameWinner(7, 0, 11, 14), -1);
});

test("match point: sisi yang tinggal satu poin", () => {
  assert.equal(matchPointMask([6, 3]), 1);
  assert.equal(matchPointMask([3, 6]), 2);
  assert.equal(matchPointMask([9, 9]), 3);
  assert.equal(matchPointMask([6, 6]), 0);
  assert.equal(matchPointMask([7, 2]), 0);
});

test("simulasi deterministik: input sama, hasil sama", () => {
  const a = runCpu([0, 4], 3000);
  const b = runCpu([0, 4], 3000);
  a.events = [];
  b.events = [];
  assert.deepEqual(a, b);
});

test("pertandingan CPU lawan CPU selesai dengan pemenang yang sah", () => {
  const s = runCpu([2, 5], 60 * 60 * 6);
  assert.equal(s.phase, "over");
  assert.ok(gameWinner(s.score[0], s.score[1]) >= 0);
});

test("pemain tidak bisa menyeberang net atau keluar lapangan", () => {
  const s = createState([0, 1]);
  for (let f = 0; f < 600; f++) step(s, [Btn.RIGHT, Btn.LEFT]);
  assert.ok(s.players[0].x < 0, "pemain kiri tetap di kiri");
  assert.ok(s.players[1].x > 0, "pemain kanan tetap di kanan");
  const t = createState([0, 1]);
  for (let f = 0; f < 600; f++) step(t, [Btn.LEFT, Btn.RIGHT]);
  assert.ok(t.players[0].x > -8 && t.players[1].x < 8);
});

test("jurus yang tidak kena bola tidak memotong meter", () => {
  const s = createState([0, 1]);
  s.phase = "play";
  s.ball.x = 6; // bola jauh di sisi lawan, di luar jangkauan
  s.ball.y = 8;
  s.ball.vy = 9;
  s.players[0].meter = 100;
  step(s, [Btn.SPECIAL, 0]);
  assert.ok(s.players[0].specialTimer > 0, "jurus siaga");
  for (let f = 0; f < 140 && s.phase === "play"; f++) {
    s.ball.x = 6;
    s.ball.y = 8;
    s.ball.vy = 0;
    step(s, [0, 0]);
  }
  assert.equal(s.players[0].meter, 100);
  assert.ok(SPECIAL_COST > 0);
});

test("sentuhan keempat satu sisi adalah fault untuk lawan", () => {
  const s = createState([0, 1]);
  s.phase = "play";
  s.lastSide = 0;
  s.touches = 3;
  s.ball.x = s.players[0].x;
  s.ball.y = s.players[0].y + 0.8;
  s.ball.vx = 0;
  s.ball.vy = 0;
  step(s, [0, 0]);
  assert.deepEqual(s.score, [0, 1]);
});

test("mode tim: jumlah pemain, sisi, dan posisi awal", () => {
  for (const size of [2, 3]) {
    const chars = Array.from({ length: size * 2 }, (_, i) => i % CHARS.length);
    const s = createState(chars);
    assert.equal(s.players.length, size * 2);
    s.players.forEach((p, i) => {
      assert.equal(Math.sign(p.x), sideOf(i) === 0 ? -1 : 1);
      assert.equal(p.x, homeX(size, i));
    });
  }
});

test("mode tim: pertandingan 2 lawan 2 dan 3 lawan 3 selesai", () => {
  for (const size of [2, 3]) {
    const chars = Array.from({ length: size * 2 }, (_, i) => (i * 2 + 1) % CHARS.length);
    const s = runCpu(chars, 60 * 60 * 8);
    assert.equal(s.phase, "over", `${size} lawan ${size}`);
  }
});

test("kulit pisang membuat pemain yang berlari kepleset, yang melompat aman", () => {
  const s = createState([0, 1]);
  s.phase = "play";
  s.ball.y = 12;
  s.ball.vy = 0;
  s.hazards.push({ kind: "peel", x: s.players[0].x + 0.4, y: 0, warn: 0, life: 400 });
  let slipped = false;
  for (let f = 0; f < 40 && !slipped; f++) {
    s.ball.y = 12;
    s.ball.vy = 0;
    step(s, [Btn.RIGHT, 0]);
    slipped = s.players[0].stun > 0;
  }
  assert.ok(slipped);
});

test("tiap karakter punya nama dan jurus yang unik namanya", () => {
  assert.equal(new Set(CHARS.map((c) => c.name)).size, CHARS.length);
  assert.equal(new Set(CHARS.map((c) => c.specialName)).size, CHARS.length);
});
