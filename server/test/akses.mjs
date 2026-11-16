// Uji tahap 5 dan 6: room Pribadi/Terbuka/Terkunci (PIN + batas percobaan), voting ganti host, keluar sengaja.
// Jalankan server dengan: npx wrangler dev --local --var GUEST_GRACE_MS:2500 --var HOST_GRACE_MS:2500 --var VOTE_AFK_MS:2000
const BASE = process.argv[2] ?? "ws://localhost:8787";
const HTTP = BASE.replace(/^ws/, "http");
const H = { Origin: "http://localhost:5173" };
let fail = 0;
const ok = (c, n) => (c || fail++, console.log(`${c ? "OK  " : "GAGAL"} ${n}`));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const code = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
const open = (role, t, q = "") =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`${BASE}/ws/${code}?pv=3&role=${role}&tok=${t}${q}`, { headers: H });
    ws.role = role;
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(String(e.data));
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("gagal " + role));
  });
const act = (ws, m) => ws.send(JSON.stringify(ws.role === "host" ? { lb: m } : { t: "lb", ...m }));
const view = (ws) => {
  for (let i = ws.inbox.length - 1; i >= 0; i--) {
    const m = JSON.parse(ws.inbox[i]);
    if (m.s === "lb" || m.t === "lb") return m;
  }
  return null;
};
const has = (ws, s) => ws.inbox.some((m) => m.includes(s));
const nacks = (ws) => ws.inbox.map((x) => JSON.parse(x)).filter((m) => m.s === "lbnack" || m.t === "lbnack").map((m) => m.why);
const rooms = async () => (await wait(2100), await fetch(`${HTTP}/rooms`, { headers: H })).json();

const HT = tok(), A = tok(), B = tok(), C = tok();
const host = await open("host", HT, "&fmt=2&name=Bos");
act(host, { a: "join" });
await wait(250);
ok(view(host).vis === "private", "room baru: Pribadi");

act(host, { a: "rules", vis: "open" });
await wait(300);
ok(view(host).vis === "open" && (await rooms()).some((r) => r.code === code && r.locked === false), "Terbuka: tampil di daftar tanpa kunci");

act(host, { a: "rules", vis: "locked", pin: "4821" });
await wait(300);
ok(view(host).vis === "locked" && view(host).pin === "4821", "Terkunci: host melihat PIN-nya");
ok((await rooms()).some((r) => r.code === code && r.locked === true), "daftar room menandai terkunci");

// PIN
const noPin = await open("guest", A);
await wait(250);
ok(has(noPin, '"type":"pin"'), "masuk tanpa PIN ditolak (minta PIN)");
const wrong = [];
for (let i = 0; i < 5; i++) {
  const w = await open("guest", B, "&pin=0000");
  await wait(150);
  wrong.push(w);
}
ok(wrong.every((w) => has(w, '"type":"pin"') || has(w, '"type":"pinlock"')), "PIN salah ditolak");
const after = await open("guest", B, "&pin=4821");
await wait(250);
ok(has(after, '"type":"pinlock"'), "setelah 5 kali salah, perangkat itu diblokir walau PIN benar");
const g1 = await open("guest", A, "&pin=4821");
act(g1, { a: "join", n: "Satu" });
await wait(300);
ok(has(g1, '"t":"hi"') && view(g1) && view(g1).pin === undefined, "PIN benar: masuk, dan tamu tidak melihat PIN");
// pemain lama masuk lagi tanpa PIN
g1.close();
await wait(300);
const g1b = await open("guest", A);
await wait(250);
ok(has(g1b, '"t":"hi"'), "pemain yang sudah ada masuk lagi tanpa PIN");
act(g1b, { a: "join" });

// Cari cepat tidak memasuki room terkunci
const q = await new Promise((res) => {
  const ws = new WebSocket(`${BASE}/queue?pv=3`, { headers: H });
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  setTimeout(() => (ws.close(), res(got)), 1200);
});
ok(!q.some((m) => m.code === code), "cari lawan cepat tidak masuk room terkunci");

// Pribadi menghapus dari daftar, PIN hilang
act(host, { a: "rules", vis: "private" });
await wait(300);
ok(view(host).vis === "private" && view(host).pin === undefined && !(await rooms()).some((r) => r.code === code), "kembali Pribadi: hilang dari daftar, tanpa PIN");
const free = await open("guest", C);
act(free, { a: "join", n: "Dua" });
await wait(300);
ok(has(free, '"t":"hi"'), "tanpa PIN, tamu baru bisa masuk lagi");

// ---- Voting ganti host ----
act(g1b, { a: "hero", k: 1 });
act(free, { a: "hero", k: 2 });
await wait(200);
act(g1b, { a: "ready", v: true });
act(free, { a: "ready", v: true });
await wait(300);
act(g1b, { a: "vote" });
await wait(200);
ok(nacks(g1b).includes("novote"), "belum boleh voting: host baru saja diam (kurang dari batas)");
await wait(2300);
act(g1b, { a: "vote" });
await wait(300);
ok(view(host).vote.votes.length === 1 && view(host).host === 0, "satu suara belum cukup (butuh mayoritas)");
act(free, { a: "vote" });
await wait(500);
ok(view(free).host === 1, "mayoritas: pemain tertua (nomor 1) jadi host");
ok(has(host, '"t":"demoted"'), "host lama diberi tahu diturunkan");
ok(view(free).seats.slice(0, 4).every((s) => !s || !s.r), "ganti host menghapus Siap");

// ---- Keluar sengaja ----
act(free, { a: "leave" });
await wait(400);
ok(!view(g1b).seats.concat(view(g1b).spec).some((s) => s && s.p === 2), "tamu yang keluar sengaja: kursinya langsung bebas");
act(g1b, { a: "leave" }); // host (nomor 1) keluar; bekas host (nomor 0) masih ada sebagai tamu
await wait(500);
ok(!has(host, '"t":"bye"'), "host keluar sengaja: room tidak ditutup");
console.log(fail ? `${fail} GAGAL` : "semua lolos");
process.exit(fail ? 1 : 0);
