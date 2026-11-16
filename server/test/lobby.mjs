// Uji daftar room terbuka. Jalankan: node test/lobby.mjs [ws://localhost:8787]
const BASE = process.argv[2] ?? "ws://localhost:8787";
const HTTP = BASE.replace(/^ws/, "http");
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (code, q) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?${q}`, { headers: H });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal " + code));
  });
const rooms = async () => (await fetch(`${HTTP}/rooms`, { headers: H })).json();

const priv = await open("PRIV", "role=host");
const pub = await open("PUBL", "role=host&public=1&name=Budi%20Kampung!");
await wait(300);
let r = await rooms();
ok(r.some((x) => x.code === "PUBL" && x.name === "Budi Kampung" && x.guests === 0), "room terbuka muncul, nama dibersihkan");
ok(!r.some((x) => x.code === "PRIV"), "room pribadi tidak muncul");

const g = await open("PUBL", "role=guest");
await wait(300);
r = await rooms();
ok(r.find((x) => x.code === "PUBL")?.guests === 1, "jumlah tamu naik");

pub.send(JSON.stringify({ hb: 1 }));
g.close();
await wait(300);
r = await rooms();
ok(r.find((x) => x.code === "PUBL")?.guests === 0, "jumlah tamu turun setelah keluar");

pub.close();
priv.close();
await wait(400);
r = await rooms();
ok(!r.some((x) => x.code === "PUBL"), "room hilang dari daftar saat host pergi");
const bad = await fetch(`${HTTP}/rooms`, { headers: { Origin: "https://jahat.example" } });
ok(bad.headers.get("access-control-allow-origin") === "null", "asal asing tidak diberi izin CORS");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
