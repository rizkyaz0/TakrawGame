// Bot pemain untuk uji lobi di browser: masuk lobi, memilih jagoan unik, Siap, lalu menekan KANAN saat bertanding.
// Jalankan: node test/lobbybots.mjs KODE [jumlah=5] [detik=40] [ws://localhost:8787]
const [code, count = "5", secs = "40", base = "ws://localhost:8787"] = process.argv.slice(2);
if (!code) throw new Error("pakai: node test/lobbybots.mjs KODE [jumlah] [detik] [ws-url]");
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const bots = [];
for (let n = 0; n < Number(count); n++) {
  const ws = new WebSocket(`${base}/ws/${code}?pv=3&role=guest&tok=${tok()}`, { headers: { Origin: "http://localhost:5173" } });
  const bot = { n, id: -1, seat: -2, phase: "", frames: 0, ls: "", view: null };
  bots.push(bot);
  const act = (m) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "lb", ...m }));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "hi") {
      bot.id = m.id;
      act({ a: "join", n: "Bot" + n });
    } else if (m.t === "lb") {
      bot.view = m;
      bot.phase = m.phase;
      bot.seat = m.seats.findIndex((s) => s && s.p === bot.id);
      const mine = bot.seat >= 0 ? m.seats[bot.seat] : null;
      if (mine && mine.h < 0) {
        const taken = new Set(m.seats.filter((s) => s && s.p !== bot.id).map((s) => s.h));
        let k = 3 + n * 2;
        while (taken.has(k)) k++;
        act({ a: "hero", k });
      } else if (mine && !mine.r && m.phase === "lobby") act({ a: "ready", v: true });
    } else if (m.t === "f" || m.t === "fb") {
      for (const f of m.t === "fb" ? m.f : [m]) {
        bot.frames++;
        if (f.ls) bot.ls = f.ls.join(",");
        if (f.ls) bot.seat = f.ls.indexOf(bot.id);
      }
    }
  };
  ws.onopen = () => {
    const iv = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: "i", b: 2, v: 2, p: 5 })), 100);
    setTimeout(() => (clearInterval(iv), ws.close()), Number(secs) * 1000);
  };
  ws.onerror = () => console.log(`bot ${n}: gagal tersambung`);
}
const report = () => console.log(bots.map((b) => `bot${b.n} id=${b.id} kursi=${b.seat} fase=${b.phase} frame=${b.frames} ls=[${b.ls}]`).join("\n") + "\n--");
setTimeout(report, 10000);
setTimeout(report, 25000);
setTimeout(() => process.exit(0), Number(secs) * 1000 + 500);
