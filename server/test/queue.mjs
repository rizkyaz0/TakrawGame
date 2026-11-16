// Uji cari lawan cepat. Jalankan: node test/queue.mjs [ws://localhost:8787]
const BASE = process.argv[2] ?? "ws://localhost:8787";
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = () =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/queue`, { headers: H });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(String(e.data)));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal tersambung"));
  });

const a = await q();
await wait(300);
ok(a.inbox.length === 0, "pemain pertama menunggu");
const b = await q();
await wait(400);
const ma = a.inbox[0], mb = b.inbox[0];
ok(ma?.t === "match" && mb?.t === "match", "keduanya dipasangkan");
ok(ma?.role === "host" && mb?.role === "guest", "yang menunggu jadi host, yang datang jadi tamu");
ok(ma?.code === mb?.code && /^[A-Z]{4}$/.test(ma?.code), "kode room sama dan valid");

// pembatalan: pemain keluar sebelum dipasangkan tidak ikut dipasangkan
const c = await q();
await wait(200);
c.close();
await wait(300);
const d = await q();
await wait(300);
ok(d.inbox.length === 0, "pemain yang batal tidak dipasangkan dengan orang baru");
d.close();

const bad = await new Promise((res) => {
  const ws = new WebSocket(`${BASE}/queue`, { headers: { Origin: "https://jahat.example" } });
  ws.onopen = () => res(false);
  ws.onerror = () => res(true);
});
ok(bad, "asal asing ditolak");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
