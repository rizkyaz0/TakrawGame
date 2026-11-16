// Uji asap: host + 2 tamu lewat server lokal (npm run dev). Jalankan: node test/smoke.mjs [ws://localhost:8787]
const BASE = process.argv[2] ?? "ws://localhost:8787";
const ORIGIN = "http://localhost:5173";
const code = "TEST";
const log = [];
let fail = 0;
const ok = (c, name) => {
  if (!c) fail++;
  console.log(`${c ? "OK  " : "GAGAL"} ${name}`);
};
const open = (role) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?pv=3&role=${role}`, { headers: { Origin: ORIGIN } });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal tersambung " + role));
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws) => (ws.inbox.length ? JSON.parse(ws.inbox[ws.inbox.length - 1]) : null);

// tamu sebelum host ada -> ditolak
const early = await open("guest");
await wait(300);
ok(early.inbox.some((m) => m.includes("peer-unavailable")), "tamu tanpa host ditolak");

const host = await open("host");
const g1 = await open("guest");
await wait(300);
ok(g1.inbox[0] === '{"t":"hi","id":1}', "tamu 1 dapat nomor 1");
ok(host.inbox.some((m) => m === '{"s":"join","id":1}'), "host diberi tahu tamu masuk");

const g2 = await open("guest");
await wait(300);
ok(g2.inbox[0] === '{"t":"hi","id":2}', "tamu 2 dapat nomor 2");

g1.send(JSON.stringify({ t: "i", b: 5 }));
await wait(200);
ok(host.inbox.includes('{"s":"msg","id":1,"m":{"t":"i","b":5}}'), "tombol tamu sampai ke host");

host.send(JSON.stringify({ m: { t: "f", n: 1 } }));
await wait(200);
ok(last(g1)?.n === 1 && last(g2)?.n === 1, "siaran host sampai ke semua tamu");

host.send(JSON.stringify({ to: 2, m: { t: "x" } }));
await wait(200);
ok(last(g2)?.t === "x" && last(g1)?.t !== "x", "pesan terarah hanya ke tamu 2");

const dup = await open("host");
await wait(300);
ok(dup.inbox.some((m) => m.includes("unavailable-id")), "host kedua ditolak (kode terpakai)");

g1.send("ping");
await wait(200);
ok(g1.inbox.includes("pong"), "ping dijawab pong");

g1.close();
await wait(300);
ok(host.inbox.includes('{"s":"leave","id":1}'), "host diberi tahu tamu keluar");

host.close();
await wait(400);
ok(g2.inbox.includes('{"t":"bye"}'), "tamu diberi tahu host pergi");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
