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

// ---- Smash tahan-bidik ----

// Pemain 0 di udara dengan bola tepat di jangkauan smash.
function aimSetup() {
  const s = createState([0, 1]);
  s.phase = "play";
  const p = s.players[0];
  p.x = -2;
  p.y = 3;
  p.grounded = false;
  s.ball.x = p.x + 0.6;
  s.ball.y = p.y + 0.9;
  s.ball.vx = 0;
  s.ball.vy = 0;
  return s;
}

test("smash: tekan-lepas cepat melesat langsung, tanpa mengapung", () => {
  const s = createState([0, 1]);
  s.phase = "play";
  const p = s.players[0];
  p.x = -2;
  p.y = 3;
  p.grounded = false;
  s.ball.x = 3;
  s.ball.y = 9;
  s.ball.vx = 0;
  s.ball.vy = 0;
  step(s, [Btn.SMASH, 0]); // tombol ditekan, bola jauh
  s.ball.vy = 0;
  s.ball.x = p.x + 0.6;
  s.ball.y = p.y + 0.9;
  step(s, [0, 0]); // sudah dilepas saat bola kena
  assert.equal(p.aimTimer, 0);
  assert.ok(s.events.some((e) => e.type === "smash"));
  assert.ok(s.ball.vx > 5, "bola melesat ke arah lawan");
});

test("smash: menahan tombol memaku karakter dan bola", () => {
  const s = aimSetup();
  const p = s.players[0];
  step(s, [Btn.SMASH, 0]);
  assert.ok(p.aimTimer > 0, "mulai membidik");
  assert.ok(s.events.some((e) => e.type === "aimStart"));
  const x0 = p.x;
  const y0 = p.y;
  const bx = s.ball.x;
  const by = s.ball.y;
  for (let f = 0; f < 6; f++) step(s, [Btn.SMASH | Btn.RIGHT, 0]);
  assert.equal(p.x, x0);
  assert.equal(p.y, y0);
  assert.equal(s.ball.x, bx);
  assert.equal(s.ball.y, by);
  assert.ok(p.aimTimer > 0);
  assert.equal(p.aimX, 1);
});

test("smash: melepas tombol menembak ke arah yang ditahan", () => {
  const s = aimSetup();
  const p = s.players[0];
  step(s, [Btn.SMASH, 0]);
  for (let f = 0; f < 5; f++) step(s, [Btn.SMASH | Btn.RIGHT | Btn.DOWN, 0]);
  step(s, [Btn.RIGHT | Btn.DOWN, 0]); // lepas
  assert.equal(p.aimTimer, 0);
  assert.ok(s.events.some((e) => e.type === "smash"));
  assert.ok(s.ball.vx > 3 && s.ball.vy < -3, "menukik ke arah lawan");
});

test("smash: lepas lebih cepat dari batas minimum tetap menunggu", () => {
  const s = aimSetup();
  const p = s.players[0];
  step(s, [Btn.SMASH, 0]);
  step(s, [0, 0]); // dilepas sesudah satu frame
  assert.ok(p.aimTimer > 0, "belum dilepas: masih di bawah batas minimum");
  for (let f = 0; f < 6 && p.aimTimer > 0; f++) step(s, [0, 0]);
  assert.equal(p.aimTimer, 0);
});

test("smash: batas waktu melepas otomatis", () => {
  const s = aimSetup();
  const p = s.players[0];
  step(s, [Btn.SMASH, 0]);
  let frames = 0;
  while (p.aimTimer > 0 && frames < 60) {
    step(s, [Btn.SMASH, 0]);
    frames++;
  }
  assert.ok(frames <= 24 && p.aimTimer === 0, "dilepas otomatis");
  assert.ok(s.ball.vx !== 0 || s.ball.vy !== 0);
});

test("smash: terhuyung saat membidik membatalkannya", () => {
  const s = aimSetup();
  const p = s.players[0];
  step(s, [Btn.SMASH, 0]);
  p.stun = 10;
  step(s, [Btn.SMASH, 0]);
  assert.equal(p.aimTimer, 0);
  assert.ok(!s.events.some((e) => e.type === "smash"));
});

test("CPU yang menahan smash tetap menyelesaikan pertandingan dengan deterministik", () => {
  const a = runCpu([1, 3], 60 * 60 * 4, 2);
  const b = runCpu([1, 3], 60 * 60 * 4, 2);
  a.events = [];
  b.events = [];
  assert.deepEqual(a, b);
});

// ---- Jurus baru: Bola Beku, Bola Batu, Bola Mantul ----

// Pemain 0 (karakter id) melepas jurusnya ke bola yang tepat di jangkauannya.
function fireSpecial(charId) {
  const s = createState([charId, 1]);
  s.phase = "play";
  const p = s.players[0];
  p.x = -2;
  p.y = 2.5;
  p.grounded = false;
  p.meter = 100;
  let hit = false;
  for (let f = 0; f < 200 && !hit; f++) {
    if (!(p.specialTimer > 0 && f > 0)) {
      s.ball.x = p.x + 0.6;
      s.ball.y = p.y + 0.9;
      s.ball.vx = 0;
      s.ball.vy = 0;
    }
    step(s, [f === 0 ? Btn.SPECIAL : 0, 0]);
    s.players[0].y = 2.5; // tetap di udara
    s.players[0].vy = 0;
    hit = s.events.some((e) => e.type === "specialHit");
  }
  assert.ok(hit, "jurus kena bola");
  while (s.hitstop > 0) step(s, [0, 0]); // habiskan pembekuan layar sesudah kena
  return s;
}

test("jurus baru: tiap karakter punya jenis yang valid", () => {
  const kinds = new Set(CHARS.map((c) => c.special));
  for (const k of ["fire", "curve", "zigzag", "meteor", "ghost", "freeze", "heavy", "bounce"]) {
    assert.ok(kinds.has(k), `ada karakter dengan jurus ${k}`);
  }
});

test("Bola Beku: berhenti di udara di atas lapangan lawan, lalu jatuh lurus", () => {
  const s = fireSpecial(CHARS.findIndex((c) => c.special === "freeze"));
  assert.equal(s.ball.freeze, 1);
  let held = 0;
  let maxHeld = 0;
  for (let f = 0; f < 240 && s.phase === "play"; f++) {
    step(s, [0, 0]);
    if (s.ball.hold > 0) {
      held++;
      maxHeld = Math.max(maxHeld, held);
      assert.equal(s.ball.vx, 0);
      assert.equal(s.ball.vy, 0);
      assert.ok(s.ball.x > 3 && s.ball.y > 2.5, "menggantung di atas sisi lawan");
    } else if (held > 0) break;
  }
  assert.ok(maxHeld >= 15, `bola menggantung (${maxHeld} frame)`);
  step(s, [0, 0]);
  assert.ok(s.ball.vy < -5, "lalu jatuh");
});

test("Bola Batu: tidak bisa di-smash balik, pemain yang mencoba kewalahan", () => {
  const s = fireSpecial(CHARS.findIndex((c) => c.special === "heavy"));
  assert.equal(s.ball.heavy, 1);
  // Lawan melompat dan men-smash bola berat di jangkauannya.
  const q = s.players[1];
  q.x = 3;
  q.y = 2.5;
  q.grounded = false;
  s.ball.x = q.x - 0.6;
  s.ball.y = q.y + 0.9;
  s.ball.vx = 0;
  s.ball.vy = 0;
  step(s, [0, Btn.SMASH]);
  assert.ok(!s.events.some((e) => e.type === "smash"), "tidak ada smash balik");
  assert.ok(q.stun > 0, "pemain kewalahan");
});

test("Bola Mantul: pantulan pertama di lantai lawan tidak dihitung poin", () => {
  const s = fireSpecial(CHARS.findIndex((c) => c.special === "bounce"));
  assert.equal(s.ball.skip, 1);
  s.players[1].x = 7.6; // lawan menjauh supaya tidak menyentuh bola
  let bounced = false;
  for (let f = 0; f < 300 && s.phase === "play"; f++) {
    const before = s.ball.skip;
    step(s, [0, 0]);
    if (before === 1 && s.ball.skip === 0) {
      bounced = true;
      assert.deepEqual(s.score, [0, 0], "belum ada poin");
      assert.ok(s.ball.vy > 5, "bola melambung");
    }
  }
  assert.ok(bounced, "memantul sekali");
  assert.deepEqual(s.score, [1, 0], "poin untuk penyerang setelah pantulan kedua");
});
