// Uji cari lawan cepat. Jalankan: node test/queue.mjs [ws://localhost:8787]
const BASE = process.argv[2] ?? "ws://localhost:8787";
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = () =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/queue?pv=3`, { headers: H });
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
  const ws = new WebSocket(`${BASE}/queue?pv=3`, { headers: { Origin: "https://jahat.example" } });
  ws.onopen = () => res(false);
  ws.onerror = () => res(true);
});
ok(bad, "asal asing ditolak");

// ---- Cari cepat mengisi room terbuka (tahap 4) ----
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const rcode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const hostRoom = (code, extra = "") =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?pv=3&role=host&tok=${tok()}${extra}`, { headers: H });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal host"));
  });
await wait(300);
// versi lama ditolak
const old = await new Promise((res) => {
  const ws = new WebSocket(`${BASE}/queue`, { headers: H });
  const got = [];
  ws.onmessage = (e) => got.push(String(e.data));
  ws.onclose = () => res(got);
  ws.onerror = () => res(got);
});
ok(old.some((m) => m.includes("outdated")), "antrean menolak klien tanpa versi protokol");
const oldRoom = await new Promise((res) => {
  const ws = new WebSocket(`${BASE}/ws/${rcode()}?role=host`, { headers: H });
  const got = [];
  ws.onmessage = (e) => got.push(String(e.data));
  ws.onclose = () => res(got);
  ws.onerror = () => res(got);
});
ok(oldRoom.some((m) => m.includes("outdated")), "room menolak klien tanpa versi protokol");

const open1 = rcode(), priv = rcode(), noq = rcode();
const hOpen = await hostRoom(open1, "&public=1&name=Terbuka&fmt=2");
const hPriv = await hostRoom(priv, "&fmt=2"); // pribadi: tidak masuk daftar
const hNoq = await hostRoom(noq, "&public=1&name=TanpaCepat&fmt=2");
hNoq.send(JSON.stringify({ lb: { a: "join" } }));
hNoq.send(JSON.stringify({ lb: { a: "rules", quick: false } }));
await wait(2300);
const s1 = await q();
await wait(1200);
const m1 = s1.inbox[0];
ok(m1?.t === "match" && m1.role === "guest" && m1.code === open1, "pencari langsung masuk room terbuka yang boleh cari cepat");
ok(m1?.code !== priv && m1?.code !== noq, "room pribadi dan yang melarang cari cepat dilewati");

// room mati (host pergi) dibersihkan dan tidak dipilih
hOpen.close();
await wait(600);
const s2 = await q();
await wait(1500);
ok(!s2.inbox.length || s2.inbox[0].code !== open1, "room yang host-nya sudah pergi tidak dipilih");

// sepi: pencari menunggu lalu diminta membuka room terbuka sendiri
await wait(300);
hNoq.close();
hPriv.close();
await wait(6500);
const m2 = s2.inbox[0];
ok(m2?.t === "match" && m2.role === "host" && m2.open === true && /^[A-Z]{4}$/.test(m2.code), "sepi 5 detik: pencari diminta jadi host room terbuka");
// host baru membuka room itu; pencari berikutnya langsung masuk
const hNew = await hostRoom(m2.code, "&public=1&name=Baru&fmt=1");
await wait(2300);
const s3 = await q();
await wait(1200);
ok(s3.inbox[0]?.role === "guest" && s3.inbox[0]?.code === m2.code, "pencari berikutnya masuk ke room yang baru dibuka");
hNew.close();
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
