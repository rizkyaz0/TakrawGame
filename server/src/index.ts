// Server perantara Takraw Clash (O2): satu Durable Object per room.
// Host tetap menjalankan simulasi; server hanya meneruskan pesan antara host dan tamu,
// memberi nomor tamu, dan menutup room saat host pergi.
//
// Protokol (JSON lewat WebSocket), `/ws/ABCD?role=host|guest` (host terbuka: `&public=1&name=Nama`), dan `GET /rooms`:
//   server -> klien  {t:"err", type}      alasan ditolak (lalu sambungan ditutup)
//   server -> tamu   {t:"hi", id}         tamu diterima dan diberi nomor
//   server -> tamu   {t:"full"} | {t:"bye"} | pesan host apa adanya
//   server -> host   {s:"join", id} | {s:"drop", id} (putus, kursi ditahan) | {s:"back", id} | {s:"leave", id}
//                    | {s:"msg", id, m} | {s:"sync", live, held} (host kembali)
//   server -> tamu   {t:"hostdrop"} | {t:"hostback"}; kunci `tok` (token tetap pemain) di URL: `&tok=<hex 16-64>`
//   host   -> server {to?: id, m}         m dikirim ke tamu `to`, atau ke semua tamu
//   host   -> server {kick: id}           keluarkan satu tamu
//   tamu   -> server pesan apa saja       diteruskan ke host sebagai {s:"msg", id, m}
//   host   -> server {pub:1|0, name?}     room jadi terbuka (1) atau pribadi (0)
//   host   -> server {hb:1}               denyut tiap ~20 detik; menyegarkan daftar room terbuka
//   `/queue` (cari lawan cepat): klien menunggu; saat dua orang menunggu, keduanya menerima
//   {t:"match", role:"host"|"guest", code} lalu ditutup; host membuka room `code`, tamu masuk ke sana.
//   Lobi server (opt-in; klien lama tidak terpengaruh). Host: kirim {lb:{a,...}}, terima {s:"lb",...} / {s:"lbnack",why};
//   tamu: kirim {t:"lb",a,...}, terima {t:"lb",...} / {t:"lbnack",why} / {t:"demoted"}. Aksi: join{n}, hero{k}, ready{v}, seat{s},
//   rules{fmt,bots,quick} (host), kick{p} (host), start/cancel/go/end (host). Setelah (re)connect kirim join lagi (idempoten).
//   Host tidak kembali dalam masa tunggu dan belum bertanding: pemain tertua yang terhubung dijadikan host.
//   Versi protokol: `&pv=3` wajib di /ws dan /queue; lebih lama dijawab {t:"err",type:"outdated"}.
//   /queue: {t:"match", role:"guest", code} (masuk room terbuka yang ada), {t:"match", role:"host", code, open:true} (buka room terbuka).
//   klien  -> server "ping"               dijawab "pong" tanpa membangunkan server
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  MATCH: DurableObjectNamespace<Matcher>;
  ALLOWED_ORIGINS: string;
  GUEST_GRACE_MS?: string; // hanya untuk uji: persingkat masa tunggu kursi
  HOST_GRACE_MS?: string;
}

const MAX_GUESTS = 6; // 3v3 penuh: lima pemain tamu + satu penonton
const MAX_GUEST_MSG = 2048; // byte: tamu hanya mengirim tombol dan perintah kecil
const MAX_HOST_MSG = 64 * 1024;

const LOBBY_TTL = 75_000; // ms: room terbuka tanpa denyut selama ini dianggap sudah mati

export type RoomInfo = { code: string; name: string; guests: number; free: number; phase: string };
const PV_MIN = 3; // versi protokol terendah yang dilayani (klien lama diminta memperbarui)
const pvOk = (url: URL) => Number(url.searchParams.get("pv")) >= PV_MIN;

// Daftar room terbuka. Satu instans global ("main"); isinya kecil dan hanya diubah room.
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, name TEXT NOT NULL, guests INTEGER NOT NULL, seen INTEGER NOT NULL)");
    // Kolom tambahan (tahap 4): sisa kursi, fase lobi, boleh cari cepat. Tabel lama diperluas di tempat.
    for (const col of ["free INTEGER NOT NULL DEFAULT 0", "quick INTEGER NOT NULL DEFAULT 0", "phase TEXT NOT NULL DEFAULT 'lobby'"]) {
      try {
        ctx.storage.sql.exec(`ALTER TABLE rooms ADD COLUMN ${col}`);
      } catch {
        // kolom sudah ada
      }
    }
  }

  upsert(code: string, name: string, guests: number, free = 0, quick = false, phase = "lobby"): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO rooms (code, name, guests, seen, free, quick, phase) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, guests = excluded.guests, seen = excluded.seen, free = excluded.free, quick = excluded.quick, phase = excluded.phase",
      code,
      name,
      guests,
      Date.now(),
      free,
      quick ? 1 : 0,
      phase,
    );
  }

  // Calon room untuk cari lawan cepat: terbuka, masih di lobi, boleh cari cepat, ada kursi kosong. Yang paling ramai dulu.
  pick(): string[] {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM rooms WHERE seen < ?", Date.now() - LOBBY_TTL);
    return sql
      .exec<{ code: string }>("SELECT code FROM rooms WHERE quick = 1 AND phase = 'lobby' AND free > 0 ORDER BY guests DESC, seen DESC LIMIT 5")
      .toArray()
      .map((r) => r.code);
  }

  remove(code: string): void {
    this.ctx.storage.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  list(): RoomInfo[] {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM rooms WHERE seen < ?", Date.now() - LOBBY_TTL);
    return sql.exec<RoomInfo>("SELECT code, name, guests, free, phase FROM rooms ORDER BY seen DESC LIMIT 30").toArray();
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

// Antrean cari lawan cepat (tanpa peringkat). Urutan: (1) masuk ke room terbuka yang masih di lobi, boleh cari cepat,
// dan punya kursi kosong (dicek hidup dulu); (2) kalau ada pencari lain yang menunggu, keduanya dipasangkan;
// (3) kalau sepi lebih dari WAIT_HOST_MS, pencari membuka room terbuka sendiri supaya pencari berikutnya bisa masuk.
const WAIT_HOST_MS = 5000;
type Wait = { w: "wait"; at: number } | { w: "done" };
export class Matcher extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    if (!pvOk(new URL(req.url))) {
      server.send(JSON.stringify({ t: "err", type: "outdated" }));
      server.close(1000, "versi lama");
      return new Response(null, { status: 101, webSocket: client });
    }
    const lobby = this.env.LOBBY.getByName("main");
    for (const code of await lobby.pick()) {
      let alive = false;
      try {
        const p = await this.env.ROOMS.getByName(code).probe();
        alive = p.alive;
        if (p.alive && p.free > 0 && p.phase === "lobby" && p.quick) {
          server.send(JSON.stringify({ t: "match", role: "guest", code }));
          server.serializeAttachment({ w: "done" } satisfies Wait);
          server.close(1000, "masuk room");
          return new Response(null, { status: 101, webSocket: client });
        }
      } catch {
        // room tidak menjawab: dianggap mati
      }
      if (!alive) await lobby.remove(code);
    }
    const other = this.ctx.getWebSockets().find((s) => s !== server && (s.deserializeAttachment() as Wait | null)?.w === "wait");
    if (other) {
      const code = randomCode();
      other.send(JSON.stringify({ t: "match", role: "host", code, open: true }));
      server.send(JSON.stringify({ t: "match", role: "guest", code }));
      other.serializeAttachment({ w: "done" } satisfies Wait);
      server.serializeAttachment({ w: "done" } satisfies Wait);
      other.close(1000, "dipasangkan");
      server.close(1000, "dipasangkan");
    } else {
      server.serializeAttachment({ w: "wait", at: Date.now() } satisfies Wait);
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + WAIT_HOST_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pencari yang sudah menunggu terlalu lama membuka room terbuka sendiri.
  async alarm(): Promise<void> {
    const now = Date.now();
    let waiting = false;
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Wait | null;
      if (a?.w !== "wait") continue;
      if (now - a.at >= WAIT_HOST_MS) {
        try {
          s.send(JSON.stringify({ t: "match", role: "host", code: randomCode(), open: true }));
          s.serializeAttachment({ w: "done" } satisfies Wait);
          s.close(1000, "buka room");
        } catch {
          // sudah tertutup
        }
      } else waiting = true;
    }
    if (waiting) await this.ctx.storage.setAlarm(now + 1000);
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      // sudah tertutup
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011);
  }
}

// Identitas tetap: klien membawa token acak yang disimpan di perangkatnya. Dengan token yang sama,
// pemain yang putus dan masuk lagi mendapat nomor, kursi, dan jagoan yang sama (tidak jadi bot, tidak berpindah).
const GUEST_GRACE = 90_000; // ms kursi tamu yang putus ditahan
const HOST_GRACE = 60_000; // ms room ditahan saat host putus
const STALE_MS = 45_000; // ms tanpa "ping" dari soket = soket dianggap mati (setengah putus)
const ALARM_MS = 10_000;
const cleanTok = (s: string | null) => (s && /^[a-f0-9]{16,64}$/.test(s) ? s : "");

type Att = { role: "host"; tok?: string; pid?: number; lb?: boolean; replaced?: boolean } | { role: "guest"; id: number; tok?: string; lb?: boolean; replaced?: boolean };

// Lobi yang dipegang server (tahap 2). Klien memilih ikut dengan pesan "lb"/"join"; klien lama tidak terpengaruh.
// Kursi 0..5: genap = Tim Merah, ganjil = Tim Biru. Hanya `fmt*2` kursi pertama yang dipakai.
// pid: 0 = host pertama, selain itu nomor tamu. Aturan (fmt/bots/quick) hanya boleh diubah host.
type Part = { h: number; r: boolean; s: number; n: string; tok: string }; // jagoan (-1 belum), siap, urutan masuk, nama, token
type Lb = {
  fmt: 1 | 2 | 3;
  bots: boolean;
  quick: boolean;
  phase: "lobby" | "count" | "play";
  at: number; // ms: kapan hitung mundur selesai
  seats: (number | null)[];
  parts: Record<string, Part>;
  host: number;
  seq: number;
};
const COUNT_MS = 3000;
const MAX_HERO = 63;
const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/[^\w ]/g, "").trim().slice(0, 16) : "");

const attOf = (ws: WebSocket) => ws.deserializeAttachment() as Att | null;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private get kv() {
    return this.ctx.storage.kv;
  }
  private hostSock(): WebSocket | undefined {
    return this.ctx.getWebSockets().find((s) => {
      const a = attOf(s);
      return a?.role === "host" && !a.replaced;
    });
  }
  private guestSocks(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((s) => {
      const a = attOf(s);
      return s !== except && a?.role === "guest" && !a.replaced;
    });
  }
  private tk = () => this.kv.get<Record<string, number>>("tk") ?? {};
  private drops = () => this.kv.get<Record<string, number>>("drop") ?? {};
  private bans = () => this.kv.get<string[]>("ban") ?? [];


  // ---- Lobi yang dipegang server ----
  private getLb = () => this.kv.get<Lb>("lb") ?? null;
  private lbOnline(lb: Lb, pid: number): boolean {
    if (pid === lb.host) return !!this.hostSock();
    return this.guestSocks().some((s) => (attOf(s) as { id: number }).id === pid);
  }
  private lbCount(lb: Lb, team: number): number {
    let n = 0;
    for (let k = team; k < lb.fmt * 2; k += 2) if (lb.seats[k] !== null) n++;
    return n;
  }
  // Kursi pertama yang kosong, mulai dari tim yang pemainnya lebih sedikit.
  private lbPlace(lb: Lb, pid: number): void {
    if (lb.seats.includes(pid)) return;
    const first = this.lbCount(lb, 0) <= this.lbCount(lb, 1) ? 0 : 1;
    for (const team of [first, 1 - first]) {
      for (let k = team; k < lb.fmt * 2; k += 2) {
        if (lb.seats[k] === null) {
          lb.seats[k] = pid;
          return;
        }
      }
    }
  }
  private lbFill(lb: Lb): void {
    const waiting = Object.keys(lb.parts)
      .map(Number)
      .filter((pid) => !lb.seats.includes(pid))
      .sort((a, b) => lb.parts[a].s - lb.parts[b].s);
    for (const pid of waiting) this.lbPlace(lb, pid);
  }
  private lbCancel(lb: Lb): void {
    if (lb.phase === "count") {
      lb.phase = "lobby";
      lb.at = 0;
    }
  }
  private lbRemove(pid: number): void {
    const lb = this.getLb();
    if (!lb || !lb.parts[pid]) return;
    delete lb.parts[pid];
    lb.seats = lb.seats.map((p) => (p === pid ? null : p));
    this.lbFill(lb);
    this.lbCancel(lb);
    this.kv.put("lb", lb);
    this.lbSend();
  }
  private lbView(lb: Lb) {
    const info = (pid: number) => {
      const p = lb.parts[pid];
      return { p: pid, h: p.h, r: p.r, n: p.n, o: this.lbOnline(lb, pid) };
    };
    return {
      fmt: lb.fmt,
      bots: lb.bots,
      quick: lb.quick,
      phase: lb.phase,
      left: lb.phase === "count" ? Math.max(0, lb.at - Date.now()) : 0,
      host: lb.host,
      seats: lb.seats.map((pid, k) => (pid === null || k >= lb.fmt * 2 ? null : info(pid))),
      spec: Object.keys(lb.parts)
        .map(Number)
        .filter((pid) => !lb.seats.includes(pid))
        .sort((a, b) => lb.parts[a].s - lb.parts[b].s)
        .map(info),
    };
  }
  private lbSend(): void {
    const lb = this.getLb();
    if (!lb) return;
    this.publish(this.kv.get<string>("code") ?? "");
    const v = this.lbView(lb);
    const toHost = JSON.stringify({ s: "lb", ...v });
    const toGuest = JSON.stringify({ t: "lb", ...v });
    for (const ws of this.ctx.getWebSockets()) {
      const a = attOf(ws);
      if (!a || a.replaced || !a.lb) continue;
      try {
        ws.send(a.role === "host" ? toHost : toGuest);
      } catch {
        // sedang menutup
      }
    }
  }
  private lbNack(ws: WebSocket, why: string): void {
    try {
      ws.send(JSON.stringify(attOf(ws)?.role === "host" ? { s: "lbnack", why } : { t: "lbnack", why }));
    } catch {
      // sedang menutup
    }
  }

  private lbAct(ws: WebSocket, m: Record<string, unknown>): void {
    const a = attOf(ws);
    const lb = this.getLb();
    if (!a || !lb) return;
    const isHost = a.role === "host";
    const pid = a.role === "host" ? (a.pid ?? lb.host) : a.id;
    const me = lb.parts[pid];
    const act = m.a;
    if (act === "join") {
      ws.serializeAttachment({ ...a, lb: true });
      if (!me) {
        if (!a.tok) return this.lbNack(ws, "notok");
        lb.parts[pid] = { h: -1, r: false, s: lb.seq++, n: cleanName(m.n) || `Pemain ${pid}`, tok: a.tok };
        this.lbPlace(lb, pid);
        this.lbCancel(lb);
        this.kv.put("lb", lb);
      } else if (typeof m.n === "string" && cleanName(m.n)) {
        me.n = cleanName(m.n);
        this.kv.put("lb", lb);
      }
      this.lbSend();
      return;
    }
    if (!me) return this.lbNack(ws, "notjoined");
    const seat = lb.seats.indexOf(pid);
    const inLobby = lb.phase === "lobby";
    if (act === "hero") {
      const k = Number(m.k);
      if (!Number.isInteger(k) || k < 0 || k > MAX_HERO) return this.lbNack(ws, "bad");
      if (!inLobby) return this.lbNack(ws, "locked");
      if (seat < 0) return this.lbNack(ws, "spectator");
      for (let o = seat % 2; o < lb.fmt * 2; o += 2) {
        const other = lb.seats[o];
        if (other !== null && other !== pid && lb.parts[other].h === k) return this.lbNack(ws, "taken");
      }
      me.h = k;
      me.r = false;
    } else if (act === "ready") {
      const v = m.v === true;
      if (v) {
        if (!inLobby) return this.lbNack(ws, "locked");
        if (seat < 0) return this.lbNack(ws, "spectator");
        if (me.h < 0) return this.lbNack(ws, "nohero");
      } else if (lb.phase === "play") return this.lbNack(ws, "locked");
      me.r = v;
      if (!v) this.lbCancel(lb);
    } else if (act === "seat") {
      const k = Number(m.s);
      if (!inLobby) return this.lbNack(ws, "locked");
      if (!Number.isInteger(k) || k < 0 || k >= lb.fmt * 2 || lb.seats[k] !== null) return this.lbNack(ws, "occupied");
      if (seat >= 0) lb.seats[seat] = null;
      lb.seats[k] = pid;
      me.r = false;
      if (me.h >= 0) {
        for (let o = k % 2; o < lb.fmt * 2; o += 2) {
          const other = lb.seats[o];
          if (other !== null && other !== pid && lb.parts[other].h === me.h) me.h = -1;
        }
      }
      this.lbFill(lb);
    } else if (act === "rules") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      if (!inLobby) return this.lbNack(ws, "locked");
      const fmt = Number(m.fmt ?? lb.fmt);
      if (fmt !== 1 && fmt !== 2 && fmt !== 3) return this.lbNack(ws, "bad");
      lb.bots = m.bots === undefined ? lb.bots : m.bots === true;
      lb.quick = m.quick === undefined ? lb.quick : m.quick === true;
      if (fmt !== lb.fmt) {
        lb.fmt = fmt;
        // kursi di luar format dikosongkan; pemainnya pindah ke kursi lain yang kosong, kalau tidak jadi penonton
        const out = lb.seats.map((p, k) => (k >= fmt * 2 ? p : null)).filter((p): p is number => p !== null);
        lb.seats = lb.seats.map((p, k) => (k >= fmt * 2 ? null : p));
        for (const p of out) this.lbPlace(lb, p);
        this.lbFill(lb);
        // jagoan kembar dalam satu tim (setelah pindah kursi) dihapus pilihannya
        for (let team = 0; team < 2; team++) {
          const seen = new Set<number>();
          for (let k = team; k < fmt * 2; k += 2) {
            const p = lb.seats[k];
            if (p === null) continue;
            const h = lb.parts[p].h;
            if (h >= 0 && seen.has(h)) lb.parts[p].h = -1;
            seen.add(h);
          }
        }
      }
      for (const p of Object.values(lb.parts)) p.r = false;
      this.lbCancel(lb);
      this.publish(this.kv.get<string>("code") ?? "");
    } else if (act === "kick") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      const target = Number(m.p);
      if (!lb.parts[target] || target === pid) return this.lbNack(ws, "bad");
      this.kv.put("lb", lb);
      this.kickGuest(target);
      return; // kickGuest memanggil lbRemove
    } else if (act === "start") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      if (!inLobby) return this.lbNack(ws, "locked");
      const seated = lb.seats.slice(0, lb.fmt * 2).filter((p): p is number => p !== null);
      if (seated.some((p) => !this.lbOnline(lb, p))) return this.lbNack(ws, "offline");
      if (seated.some((p) => !lb.parts[p].r)) return this.lbNack(ws, "notready");
      if (this.lbCount(lb, 0) === 0 || this.lbCount(lb, 1) === 0) return this.lbNack(ws, "noteam");
      if (!lb.bots && seated.length < lb.fmt * 2) return this.lbNack(ws, "needfull");
      lb.phase = "count";
      lb.at = Date.now() + COUNT_MS;
    } else if (act === "cancel") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      this.lbCancel(lb);
    } else if (act === "go") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      if (lb.phase !== "count" || Date.now() < lb.at - 300) return this.lbNack(ws, "early");
      lb.phase = "play";
    } else if (act === "end") {
      if (!isHost) return this.lbNack(ws, "hostonly");
      if (lb.phase !== "play") return this.lbNack(ws, "bad");
      lb.phase = "lobby";
      lb.at = 0;
      for (const p of Object.values(lb.parts)) p.r = false;
    } else return this.lbNack(ws, "bad");
    this.kv.put("lb", lb);
    this.lbSend();
  }

  // Keluarkan satu tamu: tokennya dilarang masuk lagi ke room ini, kursinya dikosongkan.
  private kickGuest(id: number): void {
    const map = this.tk();
    const tok = Object.keys(map).find((t) => map[t] === id) ?? this.getLb()?.parts[id]?.tok;
    if (tok) {
      this.kv.put("ban", [...this.bans(), tok].slice(-50));
      delete map[tok];
      this.kv.put("tk", map);
    }
    const host = this.hostSock();
    const drop = this.drops();
    if (drop[String(id)] !== undefined) {
      delete drop[String(id)];
      this.kv.put("drop", drop);
      host?.send(JSON.stringify({ s: "leave", id }));
    }
    const target = this.guestSocks().find((s) => (attOf(s) as { id: number }).id === id);
    if (target) {
      const t = attOf(target);
      if (t) target.serializeAttachment({ ...t, replaced: true });
      try {
        target.send(JSON.stringify({ t: "err", type: "banned" }));
        target.close(1000, "dikeluarkan");
      } catch {
        // sudah tertutup
      }
      host?.send(JSON.stringify({ s: "leave", id }));
    }
    this.lbRemove(id);
    this.publish(this.kv.get<string>("code") ?? "");
  }

  // Host tidak kembali sampai masa tunggu habis (dan belum bertanding): pemain tertua yang masih terhubung jadi host.
  private promote(): boolean {
    const lb = this.getLb();
    if (!lb || lb.phase === "play") return false;
    const cands = this.guestSocks()
      .filter((s) => attOf(s)?.lb && attOf(s)?.tok)
      .sort((x, y) => lb.parts[(attOf(x) as { id: number }).id]?.s - lb.parts[(attOf(y) as { id: number }).id]?.s);
    const ws = cands[0];
    if (!ws) return false;
    const a = attOf(ws) as { id: number; tok: string };
    const map = this.tk();
    delete map[a.tok];
    this.kv.put("tk", map);
    const drop = this.drops();
    delete drop[String(a.id)];
    this.kv.put("drop", drop);
    this.kv.put("htok", a.tok);
    this.kv.put("hdrop", 0);
    lb.host = a.id;
    lb.phase = "lobby";
    lb.at = 0;
    for (const p of Object.values(lb.parts)) p.r = false;
    this.kv.put("lb", lb);
    ws.serializeAttachment({ role: "host", tok: a.tok, pid: a.id, lb: true } satisfies Att);
    const live = this.guestSocks().map((s) => (attOf(s) as { id: number }).id);
    ws.send(JSON.stringify({ s: "sync", live, held: Object.keys(this.drops()).map(Number) }));
    for (const g of this.guestSocks()) g.send(JSON.stringify({ t: "hostback" }));
    this.lbSend();
    return true;
  }

  // Memberi tahu daftar room terbuka (hanya bila host memilih room terbuka).
  private publish(code: string, leaving?: WebSocket): void {
    if (!this.kv.get<boolean>("public")) return;
    const guests = this.guestSocks(leaving).length;
    const name = this.kv.get<string>("name") ?? "Room";
    const lb = this.getLb();
    const free = lb ? lb.seats.slice(0, lb.fmt * 2).filter((p) => p === null).length : 0;
    const quick = !!lb?.quick;
    const phase = lb?.phase ?? "lobby";
    this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").upsert(code, name, guests, free, quick, phase)));
  }

  // Dipanggil Matcher: apakah room ini masih hidup dan menerima pemain lewat cari lawan cepat?
  probe(): { alive: boolean; free: number; phase: string; quick: boolean } {
    const lb = this.getLb();
    const free = lb ? lb.seats.slice(0, lb.fmt * 2).filter((p) => p === null).length : 0;
    return { alive: !!this.hostSock(), free, phase: lb?.phase ?? "lobby", quick: !!lb?.quick };
  }

  private ensureAlarm(): void {
    this.ctx.waitUntil(
      (async () => {
        if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
      })(),
    );
  }

  private replace(old: WebSocket | undefined): void {
    if (!old) return;
    const a = attOf(old);
    if (a) old.serializeAttachment({ ...a, replaced: true });
    try {
      old.send(JSON.stringify({ t: "err", type: "replaced" }));
      old.close(1000, "diganti");
    } catch {
      // sudah tertutup
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let role: "host" | "guest" = url.searchParams.get("role") === "host" ? "host" : "guest";
    const code = url.pathname.slice(-4);
    const tok = cleanTok(url.searchParams.get("tok"));
    let demoted = false;
    if (!pvOk(url)) {
      const old = new WebSocketPair();
      this.ctx.acceptWebSocket(old[1]);
      old[1].send(JSON.stringify({ t: "err", type: "outdated" }));
      old[1].close(1000, "versi lama");
      return new Response(null, { status: 101, webSocket: old[0] });
    }
    {
      // Bekas host yang sudah digantikan masuk lagi: jadi tamu biasa dengan nomornya semula.
      const lb0 = this.getLb();
      if (role === "host" && tok && tok !== this.kv.get<string>("htok") && lb0) {
        const pid = Object.keys(lb0.parts).find((k) => lb0.parts[k].tok === tok && Number(k) !== lb0.host);
        if (pid !== undefined) {
          const map0 = this.tk();
          map0[tok] = Number(pid);
          this.kv.put("tk", map0);
          role = "guest";
          demoted = true;
        }
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const hostWs = this.hostSock();
    const now = Date.now();
    const kv = this.kv;
    const reject = (m: object) => {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify(m));
      server.close(1000, "ditolak");
    };

    if (role === "host") {
      const htok = kv.get<string>("htok") ?? "";
      const hdrop = kv.get<number>("hdrop") ?? 0;
      const resuming = !!tok && tok === htok && (!!hostWs || hdrop > now);
      if (hostWs && !resuming) reject({ t: "err", type: "unavailable-id" });
      else if (resuming) {
        // Host yang sama masuk lagi: ambil alih, beri tahu tamu, dan sinkronkan daftar tamu.
        this.replace(hostWs);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: "host", tok } satisfies Att);
        kv.put("hdrop", 0);
        const live = this.guestSocks().map((s) => (attOf(s) as { id: number }).id);
        server.send(JSON.stringify({ s: "sync", live, held: Object.keys(this.drops()).map(Number) }));
        for (const g of this.guestSocks()) g.send(JSON.stringify({ t: "hostback" }));
        const att = attOf(server);
        if (att && att.role === "host") server.serializeAttachment({ ...att, pid: this.getLb()?.host ?? 0 });
        this.ctx.waitUntil(Promise.resolve().then(() => this.lbSend()));
      } else {
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: "host", tok } satisfies Att);
        kv.put("nextId", 1);
        kv.put("tk", {});
        kv.put("drop", {});
        kv.put("ban", []);
        kv.put("htok", tok);
        kv.put("hdrop", 0);
        kv.put("public", url.searchParams.get("public") === "1");
        kv.put("name", (url.searchParams.get("name") ?? "").replace(/[^\w ]/g, "").trim().slice(0, 16) || "Pemain");
        kv.put("code", code);
        const fmt = Number(url.searchParams.get("fmt"));
        kv.put("lb", {
          fmt: fmt === 2 || fmt === 3 ? fmt : 1,
          bots: true,
          quick: true,
          phase: "lobby",
          at: 0,
          seats: [0, null, null, null, null, null],
          parts: { "0": { h: -1, r: false, s: 0, n: cleanName(url.searchParams.get("name")) || "Host", tok } },
          host: 0,
          seq: 1,
        } satisfies Lb);
        server.send(JSON.stringify({ s: "sync", live: [], held: [] })); // room baru: daftar tamu kosong
        this.publish(code);
      }
    } else if (!hostWs && (kv.get<number>("hdrop") ?? 0) <= now) {
      reject({ t: "err", type: "peer-unavailable" });
    } else if (tok && this.bans().includes(tok)) {
      reject({ t: "err", type: "banned" });
    } else {
      const map = this.tk();
      const drop = this.drops();
      let id = tok ? map[tok] : undefined;
      if (id !== undefined) {
        // Pemain lama kembali: kursinya (nomor yang sama) langsung diserahkan lagi.
        const old = this.guestSocks().find((s) => (attOf(s) as { id: number }).id === id);
        this.replace(old);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: "guest", id, tok } satisfies Att);
        server.send(JSON.stringify({ t: "hi", id }));
        if (demoted) server.send(JSON.stringify({ t: "demoted" }));
        if (drop[id] !== undefined) {
          delete drop[id];
          kv.put("drop", drop);
        }
        hostWs?.send(JSON.stringify({ s: "back", id }));
        this.ctx.waitUntil(Promise.resolve().then(() => this.lbSend()));
      } else if (this.guestSocks().length + Object.keys(drop).length >= MAX_GUESTS) {
        reject({ t: "full" });
      } else {
        id = (kv.get<number>("nextId") ?? 1) as number;
        kv.put("nextId", id + 1);
        if (tok) {
          map[tok] = id;
          kv.put("tk", map);
        }
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: "guest", id, tok } satisfies Att);
        server.send(JSON.stringify({ t: "hi", id }));
        hostWs?.send(JSON.stringify({ s: "join", id }));
      }
      this.publish(code);
    }
    this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return;
    const a = attOf(ws);
    if (!a || a.replaced) return;
    if (a.role === "guest") {
      if (raw.length > MAX_GUEST_MSG) return;
      let m: unknown;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m && typeof m === "object" && (m as { t?: unknown }).t === "lb") {
        this.lbAct(ws, m as Record<string, unknown>);
        return;
      }
      this.hostSock()?.send(JSON.stringify({ s: "msg", id: a.id, m }));
      return;
    }
    if (raw.length > MAX_HOST_MSG) return;
    let env: { to?: unknown; m?: unknown; kick?: unknown; hb?: unknown; pub?: unknown; name?: unknown; lb?: unknown };
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    if (env.lb && typeof env.lb === "object") {
      this.lbAct(ws, env.lb as Record<string, unknown>);
      return;
    }
    if ((env as { t?: unknown }).t === "lb") {
      // klien yang baru dijadikan host mungkin masih mengirim dalam format tamu
      this.lbAct(ws, env as Record<string, unknown>);
      return;
    }
    if (env.pub !== undefined) {
      // Host mengganti room jadi terbuka/pribadi (dan boleh mengganti nama tampilan).
      const code = this.kv.get<string>("code") ?? "";
      const open = env.pub === 1;
      this.kv.put("public", open);
      if (typeof env.name === "string") this.kv.put("name", env.name.replace(/[^\w ]/g, "").trim().slice(0, 16) || "Pemain");
      if (open) this.publish(code);
      else if (code) this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").remove(code)));
      return;
    }
    if (env.hb) {
      this.publish(this.kv.get<string>("code") ?? "");
      return;
    }
    if (typeof env.kick === "number") {
      this.kickGuest(env.kick);
      return;
    }
    if (env.m === undefined) return;
    const out = JSON.stringify(env.m);
    for (const s of this.guestSocks()) {
      const g = attOf(s) as { id: number };
      if (typeof env.to === "number" && env.to !== g.id) continue;
      try {
        s.send(out);
      } catch {
        // tamu sedang menutup
      }
    }
  }

  webSocketClose(ws: WebSocket, closeCode: number): void {
    this.gone(ws, closeCode);
  }

  webSocketError(ws: WebSocket): void {
    this.gone(ws, 1011);
  }

  private endRoom(except?: WebSocket): void {
    const code = this.kv.get<string>("code") ?? "";
    if (code) this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").remove(code)));
    this.kv.put("public", false);
    this.kv.put("hdrop", 0);
    for (const s of this.ctx.getWebSockets()) {
      if (s === except) continue;
      try {
        s.send(JSON.stringify({ t: "bye" }));
        s.close(1000, "host pergi");
      } catch {
        // sudah tertutup
      }
    }
  }

  private gone(ws: WebSocket, closeCode: number): void {
    const a = attOf(ws);
    try {
      ws.close(closeCode === 1005 || closeCode === 1006 ? 1000 : closeCode);
    } catch {
      // sudah tertutup
    }
    if (!a || a.replaced) return;
    try {
      ws.serializeAttachment({ ...a, replaced: true }); // tangani sekali saja
    } catch {
      // sudah tertutup
    }
    const code = this.kv.get<string>("code") ?? "";
    if (a.role === "guest") {
      if (a.tok && this.tk()[a.tok] === a.id) {
        // Putus: kursi ditahan selama masa tunggu; host diberi tahu "putus", bukan "keluar".
        const drop = this.drops();
        drop[String(a.id)] = Date.now() + (Number(this.env.GUEST_GRACE_MS) || GUEST_GRACE);
        this.kv.put("drop", drop);
        this.hostSock()?.send(JSON.stringify({ s: "drop", id: a.id }));
        this.ensureAlarm();
        this.lbSend();
      } else {
        this.hostSock()?.send(JSON.stringify({ s: "leave", id: a.id }));
        this.lbRemove(a.id);
      }
      this.publish(code, ws);
      return;
    }
    if (a.tok && this.kv.get<string>("htok") === a.tok && !this.hostSock()) {
      // Host putus: room ditahan sebentar; tamu diberi tahu supaya menunggu.
      this.kv.put("hdrop", Date.now() + (Number(this.env.HOST_GRACE_MS) || HOST_GRACE));
      for (const g of this.guestSocks()) g.send(JSON.stringify({ t: "hostdrop" }));
      this.ensureAlarm();
      this.lbSend();
      return;
    }
    // Host pergi: room selesai, tidak lagi terdaftar, semua tamu diberi tahu lalu ditutup.
    this.endRoom(ws);
  }

  // Tiap 10 detik: lepas kursi yang masa tunggunya habis, tutup room bila host tak kembali,
  // dan tutup soket yang tidak mengirim "ping" lagi (setengah putus, mis. HP tidur).
  async alarm(): Promise<void> {
    const now = Date.now();
    const drop = this.drops();
    const host = this.hostSock();
    for (const k of Object.keys(drop)) {
      if (drop[k] > now) continue;
      const id = Number(k);
      delete drop[k];
      const map = this.tk();
      const tok = Object.keys(map).find((t) => map[t] === id);
      if (tok) {
        delete map[tok];
        this.kv.put("tk", map);
      }
      host?.send(JSON.stringify({ s: "leave", id }));
      this.lbRemove(id);
    }
    this.kv.put("drop", drop);
    const hdrop = this.kv.get<number>("hdrop") ?? 0;
    if (hdrop > 0 && hdrop <= now && !host && !this.promote()) this.endRoom();
    for (const s of this.ctx.getWebSockets()) {
      const ts = this.ctx.getWebSocketAutoResponseTimestamp(s);
      if (ts && now - ts.getTime() > STALE_MS) {
        try {
          s.close(1001, "tidak aktif");
        } catch {
          // sudah tertutup
        }
        this.gone(s, 1001);
      }
    }
    this.publish(this.kv.get<string>("code") ?? "");
    if (this.ctx.getWebSockets().length > 0 || Object.keys(drop).length > 0 || (this.kv.get<number>("hdrop") ?? 0) > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }
}

let roomsCache: { at: number; data: RoomInfo[] } | null = null;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/ws\/([A-Z]{4})$/.exec(url.pathname);
    if (url.pathname === "/queue" && req.headers.get("Upgrade") === "websocket") {
      const origin = req.headers.get("Origin") ?? "";
      if (!env.ALLOWED_ORIGINS.split(",").includes(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) return new Response("Asal tidak diizinkan", { status: 403 });
      return env.MATCH.getByName("main").fetch(req);
    }
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/rooms") {
      const origin = req.headers.get("Origin") ?? "";
      const allowed = env.ALLOWED_ORIGINS.split(",").includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
      // Ingatan sementara 2 detik per isolat: banyak pemain membuka daftar sekaligus tidak membebani Lobby.
      if (!roomsCache || Date.now() - roomsCache.at > 2000) roomsCache = { at: Date.now(), data: await env.LOBBY.getByName("main").list() };
      const rooms = roomsCache.data;
      return Response.json(rooms, {
        headers: { "Access-Control-Allow-Origin": allowed ? origin : "null", Vary: "Origin", "Cache-Control": "no-store" },
      });
    }
    if (!m || req.headers.get("Upgrade") !== "websocket") return new Response("Tidak ditemukan", { status: 404 });
    const origin = req.headers.get("Origin") ?? "";
    if (!env.ALLOWED_ORIGINS.split(",").includes(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) return new Response("Asal tidak diizinkan", { status: 403 });
    return env.ROOMS.getByName(m[1]).fetch(req);
  },
} satisfies ExportedHandler<Env>;
