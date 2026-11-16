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

export type RoomInfo = { code: string; name: string; guests: number };

// Daftar room terbuka. Satu instans global ("main"); isinya kecil dan hanya diubah room.
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, name TEXT NOT NULL, guests INTEGER NOT NULL, seen INTEGER NOT NULL)");
  }

  upsert(code: string, name: string, guests: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO rooms (code, name, guests, seen) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, guests = excluded.guests, seen = excluded.seen",
      code,
      name,
      guests,
      Date.now(),
    );
  }

  remove(code: string): void {
    this.ctx.storage.sql.exec("DELETE FROM rooms WHERE code = ?", code);
  }

  list(): RoomInfo[] {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM rooms WHERE seen < ?", Date.now() - LOBBY_TTL);
    return sql.exec<RoomInfo>("SELECT code, name, guests FROM rooms ORDER BY seen DESC LIMIT 30").toArray();
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

// Antrean cari lawan cepat (tanpa peringkat): dua orang pertama yang menunggu dipasangkan.
export class Matcher extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const other = this.ctx.getWebSockets().find((s) => s !== server && s.deserializeAttachment() === "wait");
    if (other) {
      const code = randomCode();
      other.send(JSON.stringify({ t: "match", role: "host", code }));
      server.send(JSON.stringify({ t: "match", role: "guest", code }));
      other.serializeAttachment("done");
      server.serializeAttachment("done");
      other.close(1000, "dipasangkan");
      server.close(1000, "dipasangkan");
    } else {
      server.serializeAttachment("wait");
    }
    return new Response(null, { status: 101, webSocket: client });
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

type Att = { role: "host"; tok?: string; replaced?: boolean } | { role: "guest"; id: number; tok?: string; replaced?: boolean };

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

  // Memberi tahu daftar room terbuka (hanya bila host memilih room terbuka).
  private publish(code: string, leaving?: WebSocket): void {
    if (!this.kv.get<boolean>("public")) return;
    const guests = this.guestSocks(leaving).length;
    const name = this.kv.get<string>("name") ?? "Room";
    this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").upsert(code, name, guests)));
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
    const role = url.searchParams.get("role") === "host" ? "host" : "guest";
    const code = url.pathname.slice(-4);
    const tok = cleanTok(url.searchParams.get("tok"));
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
        if (drop[id] !== undefined) {
          delete drop[id];
          kv.put("drop", drop);
        }
        hostWs?.send(JSON.stringify({ s: "back", id }));
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
      this.hostSock()?.send(JSON.stringify({ s: "msg", id: a.id, m }));
      return;
    }
    if (raw.length > MAX_HOST_MSG) return;
    let env: { to?: unknown; m?: unknown; kick?: unknown; hb?: unknown; pub?: unknown; name?: unknown };
    try {
      env = JSON.parse(raw);
    } catch {
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
      // Dikeluarkan: token pemain dilarang masuk lagi ke room ini; kursinya langsung dikosongkan.
      const id = env.kick;
      const map = this.tk();
      const tok = Object.keys(map).find((t) => map[t] === id);
      if (tok) {
        this.kv.put("ban", [...this.bans(), tok].slice(-50));
        delete map[tok];
        this.kv.put("tk", map);
      }
      const drop = this.drops();
      if (drop[String(id)] !== undefined) {
        delete drop[String(id)];
        this.kv.put("drop", drop);
        ws.send(JSON.stringify({ s: "leave", id }));
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
        ws.send(JSON.stringify({ s: "leave", id }));
      }
      this.publish(this.kv.get<string>("code") ?? "");
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
      } else {
        this.hostSock()?.send(JSON.stringify({ s: "leave", id: a.id }));
      }
      this.publish(code, ws);
      return;
    }
    if (a.tok && this.kv.get<string>("htok") === a.tok && !this.hostSock()) {
      // Host putus: room ditahan sebentar; tamu diberi tahu supaya menunggu.
      this.kv.put("hdrop", Date.now() + (Number(this.env.HOST_GRACE_MS) || HOST_GRACE));
      for (const g of this.guestSocks()) g.send(JSON.stringify({ t: "hostdrop" }));
      this.ensureAlarm();
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
    }
    this.kv.put("drop", drop);
    const hdrop = this.kv.get<number>("hdrop") ?? 0;
    if (hdrop > 0 && hdrop <= now && !host) this.endRoom();
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
