// Liga CPU lawan CPU untuk mengukur keseimbangan karakter.
//   npm run league            40 pertandingan per pasangan, CPU Sulit
//   npm run league -- 100 1   100 pertandingan per pasangan, CPU Normal
// Tiap pasangan dimainkan di kedua sisi. Simulasinya deterministik, jadi variasi antar
// pertandingan datang dari frame awal dan server pertama yang berbeda.

import { CHARS, cpuInput, createState, gameWinner, step } from "../src/sim.ts";

const games = Number(process.argv[2] ?? 40);
const level = Number(process.argv[3] ?? 2);
const n = CHARS.length;
const wins = Array.from({ length: n }, () => new Array(n).fill(0));
const played = Array.from({ length: n }, () => new Array(n).fill(0));
let timeouts = 0;

function play(a, b, seed) {
  const s = createState([a, b]);
  s.frame = seed * 37;
  s.server = seed & 1;
  for (let f = 0; f < 60 * 60 * 6; f++) {
    step(s, [cpuInput(s, 0, level), cpuInput(s, 1, level)]);
    if (s.phase === "over") return gameWinner(s.score[0], s.score[1]);
  }
  timeouts++;
  return s.score[0] >= s.score[1] ? 0 : 1;
}

for (let a = 0; a < n; a++) {
  for (let b = 0; b < n; b++) {
    if (a === b) continue;
    for (let g = 0; g < games; g++) {
      const w = play(a, b, g + 1);
      played[a][b]++;
      played[b][a]++;
      if (w === 0) wins[a][b]++;
      else wins[b][a]++;
    }
  }
}

const rows = CHARS.map((c, i) => {
  const w = wins[i].reduce((x, y) => x + y, 0);
  const p = played[i].reduce((x, y) => x + y, 0);
  return { name: c.name, special: c.special, pct: (100 * w) / p };
}).sort((x, y) => y.pct - x.pct);

console.log(`Liga CPU tingkat ${level}, ${games} pertandingan per pasangan per sisi`);
for (const r of rows) console.log(`  ${r.name.padEnd(14)} ${r.special.padEnd(7)} ${r.pct.toFixed(1)}%`);
const spread = rows[0].pct - rows[rows.length - 1].pct;
console.log(`Selisih tertinggi-terendah: ${spread.toFixed(1)} poin. Kehabisan waktu: ${timeouts}.`);
