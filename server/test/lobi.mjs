// Uji lobi yang dipegang server (tahap 2): kursi, jagoan, siap, aturan hanya host, kick, hitung mundur, pergantian host.
// Jalankan server dengan masa tunggu pendek: npx wrangler dev --local --var GUEST_GRACE_MS:2500 --var HOST_GRACE_MS:2500
const BASE = process.argv[2] ?? "ws://localhost:8787";
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const open = (role, t, q = "") =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?role=${role}&tok=${t}${q}`, { headers: H });
    ws.role = role;
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal " + role));
  });
// kirim perintah lobi sesuai peran
const act = (ws, m) => ws.send(JSON.stringify(ws.role === "host" ? { lb: m } : { t: "lb", ...m }));
const view = (ws) => {
  for (let i = ws.inbox.length - 1; i >= 0; i--) {
    const m = JSON.parse(ws.inbox[i]);
    if (m.s === "lb" || m.t === "lb") return m;
  }
  return null;
};
const nacks = (ws) => ws.inbox.map((x) => JSON.parse(x)).filter((m) => m.s === "lbnack" || m.t === "lbnack").map((m) => m.why);
const pids = (v) => v.seats.map((s) => (s ? s.p : null));

const HT = tok(), T = [tok(), tok(), tok(), tok()];
const host = await open("host", HT, "&fmt=2&name=Bos");
act(host, { a: "join" });
await wait(300);
let v = view(host);
ok(v && v.fmt === 2 && pids(v)[0] === 0 && v.host === 0, "room baru: host duduk di kursi 0, format 2 lawan 2");

const g = [];
for (let i = 0; i < 4; i++) {
  g.push(await open("guest", T[i]));
  act(g[i], { a: "join", n: "G" + (i + 1) });
  await wait(250);
}
v = view(host);
ok(JSON.stringify(pids(v).slice(0, 4)) === "[0,1,2,3]", "tamu 1..3 otomatis duduk kursi 1,2,3 (tim bergantian)");
ok(v.spec.length === 1 && v.spec[0].p === 4, "tamu ke-4 jadi penonton (kursi penuh)");

act(host, { a: "hero", k: 5 });
act(g[1], { a: "hero", k: 5 }); // tamu 2 (kursi 2) satu tim dengan host (merah)
act(g[0], { a: "hero", k: 5 }); // tamu 1 (kursi 1) tim biru: boleh sama
await wait(300);
v = view(host);
ok(v.seats[0].h === 5 && v.seats[1].h === 5 && v.seats[2].h === -1, "jagoan kembar ditolak dalam satu tim, boleh beda tim");
ok(nacks(g[1]).includes("taken"), "yang ditolak diberi tahu (taken)");

act(g[1], { a: "ready", v: true });
await wait(150);
ok(nacks(g[1]).includes("nohero"), "siap tanpa jagoan ditolak");
act(g[1], { a: "rules", fmt: 1 });
await wait(150);
ok(nacks(g[1]).includes("hostonly") && view(host).fmt === 2, "tamu tidak bisa mengubah aturan");

act(g[1], { a: "hero", k: 7 });
act(g[2], { a: "hero", k: 8 });
act(g[3], { a: "hero", k: 9 });
await wait(200);
act(host, { a: "start" });
await wait(200);
ok(nacks(host).includes("notready"), "mulai ditolak kalau belum semua siap");
for (const w of [host, g[0], g[1], g[2]]) act(w, { a: "ready", v: true });
await wait(250);
v = view(host);
ok(v.seats.slice(0, 4).every((s) => s && s.r), "semua siap");
act(g[0], { a: "hero", k: 6 });
await wait(200);
ok(view(host).seats[1].h === 6 && view(host).seats[1].r === false, "ganti jagoan membatalkan siap");
act(g[0], { a: "ready", v: true });
await wait(150);
act(host, { a: "start" });
await wait(250);
v = view(g[0]);
ok(v.phase === "count" && v.left > 1500 && v.left <= 3000, "hitung mundur 3 detik dimulai");
act(g[0], { a: "hero", k: 11 });
await wait(150);
ok(nacks(g[0]).includes("locked"), "jagoan terkunci saat hitung mundur");
act(host, { a: "go" });
await wait(150);
ok(nacks(host).includes("early") && view(host).phase === "count", "go terlalu cepat ditolak");
act(g[0], { a: "ready", v: false });
await wait(200);
ok(view(host).phase === "lobby", "batal siap membatalkan hitung mundur");
act(g[0], { a: "ready", v: true });
await wait(150);
act(host, { a: "start" });
await wait(3400);
act(host, { a: "go" });
await wait(250);
ok(view(g[2]).phase === "play", "setelah 3 detik host kirim go: fase main");
act(host, { a: "end" });
await wait(250);
v = view(host);
ok(v.phase === "lobby" && v.seats.every((s) => !s || !s.r) && v.seats[1].h === 6, "selesai: kembali ke lobi, siap dihapus, jagoan tetap");

act(host, { a: "kick", p: 3 });
await wait(350);
v = view(host);
ok(pids(v)[3] === 4 && v.spec.length === 0, "tamu dikeluarkan: kursi terisi penonton yang menunggu");
ok(g[2].readyState >= 2 || g[2].inbox.some((m) => m.includes("banned")), "yang dikeluarkan diputus");
const again = await open("guest", T[2]);
await wait(250);
ok(again.inbox.some((m) => m.includes("banned")), "yang dikeluarkan tidak bisa masuk lagi");

act(host, { a: "rules", fmt: 1, bots: false });
await wait(300);
v = view(host);
ok(v.fmt === 1 && v.bots === false && pids(v)[0] === 0 && pids(v)[1] !== null && v.spec.length === 2, "format diperkecil: 2 kursi terisi, sisanya penonton");
act(host, { a: "rules", fmt: 2 });
await wait(300);
ok(pids(view(host)).filter((p) => p !== null).length === 4 && view(host).spec.length === 0, "format dibesarkan: penonton otomatis duduk");

// pergantian host: host putus, setelah masa tunggu pemain tertua yang online jadi host
host.close();
await wait(14500);
v = view(g[0]);
ok(v && v.host === 1, "host tidak kembali: pemain tertua (nomor 1) jadi host");
ok(g[0].inbox.some((m) => m.includes('"s":"sync"')), "host baru menerima sync");
act(g[0], { a: "rules", bots: true });
await wait(200);
ok(view(g[0]).bots === true && !nacks(g[0]).includes("hostonly"), "host baru boleh mengubah aturan");
const old = await open("host", HT);
act(old, { a: "join" });
await wait(300);
ok(old.inbox.some((m) => m.includes('"t":"demoted"')) , "bekas host yang kembali diberi tahu sudah digantikan");
old.role = "guest";
act(old, { a: "rules", fmt: 1 });
await wait(200);
ok(nacks(old).includes("hostonly"), "bekas host tidak bisa lagi mengubah aturan");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
