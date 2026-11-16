// Server perantara Takraw Clash (O2): satu Durable Object per room.
// Host tetap menjalankan simulasi; server hanya meneruskan pesan antara host dan tamu,
// memberi nomor tamu, dan menutup room saat host pergi.
//
// Protokol (JSON lewat WebSocket), `/ws/ABCD?role=host|guest` (host terbuka: `&public=1&name=Nama`), dan `GET /rooms`:
//   server -> klien  {t:"err", type}      alasan ditolak (lalu sambungan ditutup)
//   server -> tamu   {t:"hi", id}         tamu diterima dan diberi nomor
//   server -> tamu   {t:"full"} | {t:"bye"} | pesan host apa adanya
//   server -> host   {s:"join", id} | {s:"leave", id} | {s:"msg", id, m}
//   host   -> server {to?: id, m}         m dikirim ke tamu `to`, atau ke semua tamu
//   host   -> server {kick: id}           keluarkan satu tamu
//   tamu   -> server pesan apa saja       diteruskan ke host sebagai {s:"msg", id, m}
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
}

const MAX_GUESTS = 4;
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

type Att = { role: "host" } | { role: "guest"; id: number };

const attOf = (ws: WebSocket) => ws.deserializeAttachment() as Att | null;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // Memberi tahu daftar room terbuka (hanya bila host memilih room terbuka).
  private publish(code: string, leaving?: WebSocket): void {
    if (!this.ctx.storage.kv.get<boolean>("public")) return;
    const guests = this.ctx.getWebSockets().filter((s) => s !== leaving && attOf(s)?.role === "guest").length;
    const name = this.ctx.storage.kv.get<string>("name") ?? "Room";
    this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").upsert(code, name, guests)));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "guest";
    const code = url.pathname.slice(-4);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const sockets = this.ctx.getWebSockets();
    const host = sockets.find((s) => attOf(s)?.role === "host");
    const guests = sockets.filter((s) => attOf(s)?.role === "guest");
    const reject = (m: object) => {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify(m));
      server.close(1000, "ditolak");
    };

    if (role === "host") {
      if (host) reject({ t: "err", type: "unavailable-id" });
      else {
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ role: "host" } satisfies Att);
        this.ctx.storage.kv.put("nextId", 1);
        const open = url.searchParams.get("public") === "1";
        this.ctx.storage.kv.put("public", open);
        this.ctx.storage.kv.put("name", (url.searchParams.get("name") ?? "").replace(/[^\w ]/g, "").trim().slice(0, 16) || "Pemain");
        this.ctx.storage.kv.put("code", code);
        this.publish(code);
      }
    } else if (!host) {
      reject({ t: "err", type: "peer-unavailable" });
    } else if (guests.length >= MAX_GUESTS) {
      reject({ t: "full" });
    } else {
      const id = (this.ctx.storage.kv.get<number>("nextId") ?? 1) as number;
      this.ctx.storage.kv.put("nextId", id + 1);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: "guest", id } satisfies Att);
      server.send(JSON.stringify({ t: "hi", id }));
      host.send(JSON.stringify({ s: "join", id }));
      this.publish(code);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return;
    const a = attOf(ws);
    if (!a) return;
    if (a.role === "guest") {
      if (raw.length > MAX_GUEST_MSG) return;
      const host = this.ctx.getWebSockets().find((s) => attOf(s)?.role === "host");
      let m: unknown;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      host?.send(JSON.stringify({ s: "msg", id: a.id, m }));
      return;
    }
    if (raw.length > MAX_HOST_MSG) return;
    let env: { to?: unknown; m?: unknown; kick?: unknown; hb?: unknown };
    try {
      env = JSON.parse(raw);
    } catch {
      return;
    }
    if (env.hb) {
      this.publish(this.ctx.storage.kv.get<string>("code") ?? "");
      return;
    }
    if (typeof env.kick === "number") {
      const target = this.ctx.getWebSockets().find((s) => {
        const g = attOf(s);
        return g?.role === "guest" && g.id === env.kick;
      });
      target?.close(1000, "dikeluarkan");
      return;
    }
    if (env.m === undefined) return;
    const out = JSON.stringify(env.m);
    for (const s of this.ctx.getWebSockets()) {
      const g = attOf(s);
      if (g?.role !== "guest") continue;
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

  private gone(ws: WebSocket, closeCode: number): void {
    const a = attOf(ws);
    try {
      ws.close(closeCode === 1005 || closeCode === 1006 ? 1000 : closeCode);
    } catch {
      // sudah tertutup
    }
    if (!a) return;
    const sockets = this.ctx.getWebSockets().filter((s) => s !== ws);
    const code = this.ctx.storage.kv.get<string>("code") ?? "";
    if (a.role === "guest") {
      sockets.find((s) => attOf(s)?.role === "host")?.send(JSON.stringify({ s: "leave", id: a.id }));
      this.publish(code, ws);
      return;
    }
    // Host pergi: room selesai, tidak lagi terdaftar, semua tamu diberi tahu lalu ditutup.
    if (code) this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName("main").remove(code)));
    this.ctx.storage.kv.put("public", false);
    for (const s of sockets) {
      try {
        s.send(JSON.stringify({ t: "bye" }));
        s.close(1000, "host pergi");
      } catch {
        // sudah tertutup
      }
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
