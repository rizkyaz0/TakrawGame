// Uji identitas tetap: putus/masuk lagi, ganti soket, kick+ban, host putus/kembali, masa tunggu habis.
// Jalankan server dengan masa tunggu pendek: npx wrangler dev --local --var GUEST_GRACE_MS:2500 --var HOST_GRACE_MS:2500
const BASE = process.argv[2] ?? "ws://localhost:8787";
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const open = (role, t) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?role=${role}&tok=${t}`, { headers: H });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal " + role));
  });
const has = (ws, s) => ws.inbox.some((m) => m.includes(s));

const HT = tok(), GT = tok(), G2 = tok();
const host = await open("host", HT);
let g = await open("guest", GT);
await wait(300);
ok(has(g, '"t":"hi","id":1'), "tamu baru dapat nomor 1");
ok(has(host, '{"s":"join","id":1}'), "host diberi tahu: masuk");

g.close();
await wait(400);
ok(has(host, '{"s":"drop","id":1}') && !has(host, '"s":"leave"'), "tamu putus: host menerima 'drop', bukan 'leave'");

g = await open("guest", GT);
await wait(300);
ok(has(g, '"t":"hi","id":1'), "token sama: kembali ke nomor 1 (kursi sama)");
ok(has(host, '{"s":"back","id":1}'), "host diberi tahu: kembali");

const g2 = await open("guest", G2);
await wait(300);
ok(has(g2, '"t":"hi","id":2'), "token lain: nomor 2");

// soket lama masih hidup lalu token sama masuk lagi: yang lama diganti
const gOld = g;
g = await open("guest", GT);
await wait(400);
ok(has(g, '"t":"hi","id":1'), "ganti soket: tetap nomor 1");
ok(gOld.readyState >= 2, "soket lama ditutup");
ok(!has(host, '{"s":"leave","id":1}'), "penggantian soket tidak dilaporkan sebagai keluar");

// kick + ban
host.send(JSON.stringify({ kick: 2 }));
await wait(400);
ok(has(g2, '"type":"banned"'), "tamu yang dikeluarkan diberi tahu");
ok(has(host, '{"s":"leave","id":2}'), "host menerima 'leave' untuk yang dikeluarkan");
const g2b = await open("guest", G2);
await wait(300);
ok(has(g2b, '"type":"banned"'), "token yang dikeluarkan tidak bisa masuk lagi");

// masa tunggu habis
g.close();
await wait(400);
ok(has(host, '{"s":"drop","id":1}'), "tamu putus lagi: 'drop'");
await wait(14000);
ok(has(host, '{"s":"leave","id":1}'), "masa tunggu habis: 'leave'");

// host putus dan kembali
const g3 = await open("guest", tok());
await wait(300);
host.close();
await wait(500);
ok(has(g3, '"t":"hostdrop"'), "host putus: tamu diberi tahu 'hostdrop'");
const host2 = await open("host", HT);
await wait(400);
ok(has(host2, '"s":"sync"'), "host kembali menerima 'sync'");
ok(has(g3, '"t":"hostback"'), "tamu diberi tahu 'hostback'");

// host putus dan tidak kembali
host2.close();
await wait(14000);
ok(has(g3, '"t":"bye"'), "host tidak kembali: room ditutup ('bye')");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
