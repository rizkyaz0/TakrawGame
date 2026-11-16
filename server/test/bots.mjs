// Bot tamu untuk menguji mabar banyak pemain tanpa banyak browser.
// Jalankan: node test/bots.mjs KODE [jumlah=5] [detik=40] [ws://localhost:8787]
// Tiap bot masuk sebagai tamu, melaporkan kursinya, memilih jagoan unik, lalu terus menekan KANAN (bits=2).
const [code, count = "5", secs = "40", base = "ws://localhost:8787"] = process.argv.slice(2);
if (!code) throw new Error("pakai: node test/bots.mjs KODE [jumlah] [detik] [ws-url]");
const bots = [];
for (let n = 0; n < Number(count); n++) {
  const ws = new WebSocket(`${base}/ws/${code}?pv=3&role=guest`, { headers: { Origin: "http://localhost:5173" } });
  const bot = { n, id: -1, seat: -2, hk: "", ts: 0, frames: 0, fb: 0 };
  bots.push(bot);
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "hi") {
      bot.id = m.id;
      // pilih jagoan berbeda per bot (nomor 6 + n supaya tidak bentrok dengan pilihan host)
      ws.send(JSON.stringify({ t: "cmd", c: "char", k: 6 + n }));
    } else if (m.t === "f" || m.t === "fb") {
      for (const f of m.t === "fb" ? m.f : [m]) {
        bot.frames++;
        bot.ts = f.ts;
        bot.hk = f.hk;
        const seats = f.seats ?? [];
        let s = seats.indexOf(bot.id);
        if (s === 2) s = 9;
        else if (s < 0 && f.xs) s = f.xs.indexOf(bot.id);
        bot.seat = s;
      }
      if (m.t === "fb") bot.fb++;
    }
  };
  ws.onopen = () => {
    const iv = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: "i", b: 2, v: 2, p: 5 })), 100);
    setTimeout(() => (clearInterval(iv), ws.close()), Number(secs) * 1000);
  };
  ws.onerror = () => console.log(`bot ${n}: gagal tersambung`);
}
const report = () => console.log(bots.map((b) => `bot${b.n} id=${b.id} kursi=${b.seat} frame=${b.frames} gabungan=${b.fb} hk=${b.hk} ts=${b.ts}`).join("\n"));
setTimeout(report, 8000);
setTimeout(report, 20000);
setTimeout(() => process.exit(0), Number(secs) * 1000 + 500);
