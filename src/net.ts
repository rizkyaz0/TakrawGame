import type { Peer } from "peerjs";

// Mabar online. Satu perangkat jadi host: ia menjalankan simulasi dan mengirim keadaan
// game ke tamu. Tamu hanya mengirim tombol yang ditekan dan menggambar apa yang diterima.
// PeerJS dipakai untuk mempertemukan perangkat lewat kode room; datanya sendiri mengalir
// langsung antar-perangkat (WebRTC). Modulnya dimuat belakangan supaya game biasa tetap ringan.

const PREFIX = "takrawclash-v1-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // tanpa I dan O supaya tidak tertukar angka
export const MAX_GUESTS = 6; // 3v3 penuh: lima pemain tamu + satu penonton
export const EMOTE_COUNT = 6;
const EMOTE_GAP = 1500; // ms: jeda minimum antar-emote dari satu tamu
const GUEST_TIMEOUT = 6000; // ms tanpa kabar sebelum tamu dianggap putus

// Sambungan ke satu tamu: PeerJS (DataConnection) atau WebSocket lewat server perantara.
export interface Conn {
  readonly open: boolean;
  send(msg: unknown): void;
  close(): void;
}

// Alamat server perantara (O2), mis. wss://takraw-clash-server.<akun>.workers.dev. Kosong = PeerJS publik.
const SERVER = ((import.meta.env.VITE_ONLINE_URL as string | undefined) ?? "").replace(/\/$/, "");

export interface Guest {
  id: number;
  conn: Conn;
  bits: number;
  aim: number | null; // bidikan penonton dari mouse, dalam koordinat lapangan
  seen: number;
  ping: number; // ms ke server perantara, dilaporkan tamu (-1 = tidak diketahui)
  v: number; // versi protokol tamu: 2 = paham frame gabungan (pesan "fb")
  dropped: boolean; // putus sementara: kursinya ditahan server, tombolnya dianggap 0
  peer: boolean; // lewat PeerJS (tanpa server perantara): keadaan hidup dicek host sendiri
  emoteAt: number;
}

export type GuestCommand = { c: "left" | "right" | "lock" } | { c: "char"; k: number };

export interface HostHandlers {
  onJoin(id: number): void;
  onLeave(id: number): void;
  onCommand(id: number, cmd: GuestCommand): void;
  onEmote(id: number, k: number): void;
  onDrop(id: number): void; // tamu putus sementara; kursinya ditahan
  onBack(id: number): void; // tamu yang putus kembali
  onLink?(down: boolean): void; // sambungan host ke server putus (sedang menyambung ulang) atau pulih
  onError(text: string): void;
}

export interface RoomInfo {
  code: string;
  name: string;
  guests: number;
}

// Opsi host: room terbuka tampil di daftar room dengan nama pemilik.
export interface HostOptions {
  open?: boolean;
  name?: string;
  code?: string; // kode yang ditentukan server (cari lawan cepat)
  fmt?: 1 | 2 | 3; // format awal lobi (pemain per sisi)
}
let hostOpts: HostOptions = {};

export const roomListEnabled = !!SERVER;

// Host mengganti room jadi terbuka (tampil di daftar) atau pribadi, kapan saja.
export function setRoomVisibility(open: boolean, name: string): void {
  hostOpts = { ...hostOpts, open, name };
  if (hostWs?.readyState === 1 && net.role === "host") hostWs.send(JSON.stringify({ pub: open ? 1 : 0, name }));
}

// Daftar room terbuka dari server perantara; kosong bila server tidak dipakai atau tak terjangkau.
export async function listRooms(): Promise<RoomInfo[]> {
  if (!SERVER) return [];
  try {
    const res = await fetch(`${SERVER.replace(/^ws/, "http")}/rooms`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((r): r is RoomInfo => !!r && typeof r.code === "string" && typeof r.name === "string" && typeof r.guests === "number")
      .slice(0, 30);
  } catch {
    return [];
  }
}

// Cari lawan cepat: menunggu di antrean server sampai dipasangkan. Mengembalikan fungsi pembatal.
// Versi protokol klien; server menolak yang lebih lama dengan pesan "outdated" (klien diminta memuat ulang).
export const PV = 3;

export function findMatch(h: { onMatch(role: "host" | "guest", code: string, open: boolean): void; onError(text: string): void }): () => void {
  if (!SERVER) {
    h.onError("Cari lawan butuh server online.");
    return () => undefined;
  }
  let done = false;
  const ws = new WebSocket(`${SERVER}/queue?pv=${PV}`);
  const ping = window.setInterval(() => ws.readyState === 1 && ws.send("ping"), 15000);
  ws.onmessage = (e) => {
    if (typeof e.data !== "string" || e.data === "pong") return;
    try {
      const m = JSON.parse(e.data) as { t?: string; role?: string; code?: unknown; open?: unknown; type?: string };
      if (m.t === "err") {
        done = true;
        h.onError(ERRORS[m.type ?? ""] ?? "Pencarian gagal. Coba lagi.");
      } else if (m.t === "match" && (m.role === "host" || m.role === "guest") && typeof m.code === "string" && /^[A-Z]{4}$/.test(m.code)) {
        done = true;
        h.onMatch(m.role, m.code, m.open === true);
      }
    } catch {
      // abaikan
    }
  };
  const lost = () => {
    window.clearInterval(ping);
    if (!done) {
      done = true;
      h.onError("Pencarian terputus. Coba lagi.");
    }
  };
  ws.onclose = lost;
  ws.onerror = lost;
  return () => {
    done = true;
    window.clearInterval(ping);
    ws.close();
  };
}

export interface ClientHandlers {
  onClose(text: string): void;
}

export const net = {
  role: "off" as "off" | "host" | "client",
  code: "",
  ready: false, // host: room sudah terdaftar; tamu: sudah tersambung ke host
  myId: -1, // nomor tamu, diberikan host
  guests: new Map<number, Guest>(),
  inbox: [] as unknown[], // tamu: pesan dari host yang belum diproses
  lastHeard: 0,
  ping: -1, // ms ke server perantara (tanpa server: -1)
  down: false, // host: sambungan ke server putus; tamu: host sedang putus. Keduanya menunggu pulih.
};

// ===== Lobi yang dipegang server (tahap 2) =====
// Server menyimpan kursi, jagoan, siap, dan aturan; klien hanya mengirim niat dan menampilkan keadaannya.
export interface LobbySeat {
  p: number; // nomor pemain (0 = host pertama)
  h: number; // jagoan, -1 belum memilih
  r: boolean; // siap
  n: string;
  o: boolean; // sedang tersambung
}
export interface LobbyView {
  fmt: 1 | 2 | 3;
  bots: boolean; // kursi kosong diisi bot saat mulai
  quick: boolean; // boleh dimasuki cari lawan cepat
  phase: "lobby" | "count" | "play";
  left: number; // ms sisa hitung mundur (saat diterima)
  until: number; // performance.now() saat hitung mundur selesai (0 bila tidak sedang menghitung)
  host: number; // nomor pemain yang jadi host
  seats: (LobbySeat | null)[]; // 6 kursi: genap Tim Merah, ganjil Tim Biru
  spec: LobbySeat[]; // pemain tanpa kursi
}
export const lobby = {
  want: false, // sudah ikut lobi: ikut lagi otomatis setiap sambungan (ulang)
  view: null as LobbyView | null,
  nack: "", // alasan penolakan terakhir (taken, locked, hostonly, notready, noteam, …)
  name: "", // nama tampilan di lobi
  pid: -1, // nomorku di lobi (0 = host pertama, selain itu nomor tamu)
  demoted: false, // bekas host yang digantikan saat ia pergi
  onChange: null as (() => void) | null,
};
// Pergantian peran di tengah lobi: tamu dijadikan host oleh server, atau bekas host yang digantikan.
let roleHandlers: { promote(): void; demote(): void } | null = null;
export function setRoleHandlers(h: { promote(): void; demote(): void }): void {
  roleHandlers = h;
}
function adoptLobby(m: unknown): void {
  const v = m as Partial<LobbyView> | null;
  if (!v || !Array.isArray(v.seats) || !Array.isArray(v.spec)) return;
  const left = typeof v.left === "number" ? v.left : 0;
  lobby.view = { ...(v as LobbyView), until: v.phase === "count" ? performance.now() + left : 0 };
  lobby.onChange?.();
  if (net.role === "client" && lobby.pid >= 0 && v.host === lobby.pid) roleHandlers?.promote();
}
// Tamu yang dijadikan host: tutup soket tamu lalu sambung lagi sebagai host (server mengenali tokennya).
export function becomeHost(h: HostHandlers): void {
  session++;
  window.clearInterval(pingTimer);
  try {
    hostWs?.close();
  } catch {
    // sudah tertutup
  }
  hostConn = null;
  net.role = "host";
  net.guests.clear();
  net.inbox = [];
  net.myId = -1;
  net.ready = false;
  connectHost(h, session, 0, Date.now());
}
function lobbyNack(why: unknown): void {
  lobby.nack = typeof why === "string" ? why : "";
  lobby.onChange?.();
}
// Kirim perintah lobi: join, hero{k}, ready{v}, seat{s}, rules{fmt,bots,quick}, kick{p}, start, cancel, go, end.
export function lobbyAct(m: { a: string } & Record<string, unknown>): void {
  if (net.role === "host") {
    if (hostWs?.readyState === 1) hostWs.send(JSON.stringify({ lb: m }));
  } else sendToHost({ t: "lb", ...m });
}
export function lobbyJoin(name?: string): void {
  lobby.want = true;
  lobbyAct({ a: "join", n: name ?? (lobby.name || undefined) });
}

// Token tetap pemain, disimpan di perangkat: server memakainya untuk mengenali pemain yang sama setelah putus.
let memToken = "";
function playerToken(): string {
  try {
    const saved = localStorage.getItem("takraw.token");
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
  } catch {
    // penyimpanan diblokir: pakai token sesi ini saja
  }
  if (!memToken) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    memToken = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    try {
      localStorage.setItem("takraw.token", memToken);
    } catch {
      // diabaikan
    }
  }
  return memToken;
}

// Emote dari host (nomor kursi + emote), diteruskan ke tampilan.
let emoteHandler: ((seat: number, k: number) => void) | null = null;
export function setEmoteHandler(fn: (seat: number, k: number) => void): void {
  emoteHandler = fn;
}

// Pengukur ping: "ping" dijawab "pong" oleh server tanpa membangunkannya.
let pingAt = 0;
function sendPing(ws: WebSocket): void {
  if (ws.readyState !== 1) return;
  pingAt = performance.now();
  ws.send("ping");
}
function onPong(): void {
  if (pingAt === 0) return;
  const rtt = performance.now() - pingAt;
  net.ping = net.ping < 0 ? rtt : net.ping * 0.6 + rtt * 0.4;
  net.lastHeard = performance.now();
}

let peer: Peer | null = null;
let hostConn: Conn | null = null;
let hostWs: WebSocket | null = null; // host lewat server perantara
let pingTimer = 0;
let nextGuest = 1;
let session = 0; // naik tiap kali room dibuka/ditutup; panggilan balik lama diabaikan

function randomCode(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export function roomLink(): string {
  return `${location.origin}${location.pathname}?room=${net.code}`;
}

export function closeNet(): void {
  session++;
  lobby.want = false;
  lobby.pid = -1;
  lobby.view = null;
  lobby.nack = "";
  lobby.demoted = false;
  try {
    peer?.destroy();
  } catch {
    // sudah mati
  }
  peer = null;
  hostConn = null;
  window.clearInterval(pingTimer);
  try {
    hostWs?.close();
  } catch {
    // sudah mati
  }
  hostWs = null;
  net.ping = -1;
  net.down = false;
  pingAt = 0;
  net.role = "off";
  net.code = "";
  net.ready = false;
  net.myId = -1;
  net.guests.clear();
  net.inbox.length = 0;
}

const ERRORS: Record<string, string> = {
  "peer-unavailable": "Room tidak ditemukan. Cek lagi kodenya.",
  network: "Tidak bisa menghubungi server perantara. Cek internetmu.",
  "server-error": "Server perantara sedang bermasalah. Coba lagi sebentar.",
  "socket-error": "Sambungan ke server perantara putus.",
  "socket-closed": "Sambungan ke server perantara putus.",
  "browser-incompatible": "Browser ini tidak mendukung sambungan langsung (WebRTC).",
  webrtc: "Sambungan langsung antar-perangkat gagal.",
  "ws-failed": "Tidak bisa menghubungi server. Cek internetmu.",
  outdated: "Versi game kamu sudah lama. Perbarui dulu supaya cocok dengan server.",
  banned: "Kamu dikeluarkan dari room ini oleh host.",
  replaced: "Akunmu masuk dari tab atau perangkat lain, jadi sambungan ini ditutup.",
};

// Data dari tamu: jangan percaya bentuknya.
function onGuestData(g: Guest, raw: unknown, h: HostHandlers): void {
  const m = raw as { t?: unknown; b?: unknown; x?: unknown; c?: unknown; k?: unknown; p?: unknown; v?: unknown } | null;
  if (!m || typeof m !== "object") return;
  g.seen = performance.now();
  if (m.t === "i") {
    g.bits = typeof m.b === "number" ? m.b & 0x1ff : 0;
    g.aim = typeof m.x === "number" && Number.isFinite(m.x) ? m.x : null;
    g.ping = typeof m.p === "number" && Number.isFinite(m.p) ? Math.min(2000, Math.max(0, m.p)) : -1;
    g.v = m.v === 2 ? 2 : 1;
  } else if (m.t === "emo") {
    const now = performance.now();
    if (typeof m.k === "number" && Number.isInteger(m.k) && m.k >= 0 && m.k < EMOTE_COUNT && now - g.emoteAt >= EMOTE_GAP) {
      g.emoteAt = now;
      h.onEmote(g.id, m.k);
    }
  } else if (m.t === "cmd") {
    if (m.c === "left" || m.c === "right" || m.c === "lock") h.onCommand(g.id, { c: m.c });
    else if (m.c === "char" && typeof m.k === "number" && Number.isInteger(m.k)) h.onCommand(g.id, { c: "char", k: m.k });
  }
}

// Pesan dari host untuk tamu (sama untuk PeerJS dan WebSocket).
function onHostMsg(m: { t?: string; id?: number } | null, fail: (t: string) => void, ready: () => void): void {
  if (!m || typeof m !== "object") return;
  net.lastHeard = performance.now();
  if (m.t === "hi" && typeof m.id === "number") {
    net.myId = m.id;
    lobby.pid = m.id;
    net.ready = true;
    ready();
    if (lobby.want && SERVER) lobbyJoin();
  } else if (m.t === "lb") adoptLobby(m);
  else if (m.t === "lbnack") lobbyNack((m as { why?: unknown }).why);
  else if (m.t === "demoted") lobby.demoted = true;
  else if (m.t === "fb") {
    // Beberapa frame dalam satu pesan: dimasukkan satu per satu ke antrean.
    const f = (m as { f?: unknown }).f;
    if (Array.isArray(f)) {
      for (const fr of f.slice(0, 8)) if (fr && typeof fr === "object") net.inbox.push(fr);
      if (net.inbox.length > 120) net.inbox.splice(0, net.inbox.length - 120);
    }
  } else if (m.t === "hostdrop") net.down = true;
  else if (m.t === "hostback") net.down = false;
  else if (m.t === "emo") {
    const e = m as { s?: unknown; k?: unknown };
    if (typeof e.s === "number" && typeof e.k === "number" && Number.isInteger(e.k) && e.k >= 0 && e.k < EMOTE_COUNT) emoteHandler?.(e.s, e.k);
  } else if (m.t === "full") fail("Room sudah penuh.");
  else if (m.t === "bye") fail("Host menutup room.");
  else {
    net.inbox.push(m);
    if (net.inbox.length > 120) net.inbox.splice(0, net.inbox.length - 120);
  }
}

// ===== Host lewat server perantara (WebSocket) =====
function hostRoomWs(h: HostHandlers, attempt: number): void {
  net.role = "host";
  // Kode dari server (cari lawan cepat) dipakai pada percobaan pertama; bila terpakai, ambil acak.
  net.code = attempt === 0 && hostOpts.code ? hostOpts.code : randomCode();
  connectHost(h, session, attempt, 0);
}

// resumeSince > 0: sedang menyambung ulang ke room yang sama (sejak waktu itu); server mengenali host lewat token.
function connectHost(h: HostHandlers, mine: number, attempt: number, resumeSince: number): void {
  const resume = resumeSince > 0;
  const q = !resume ? `&fmt=${hostOpts.fmt ?? 1}&name=${encodeURIComponent(hostOpts.name ?? "Pemain")}${hostOpts.open ? "&public=1" : ""}` : "";
  const ws = new WebSocket(`${SERVER}/ws/${net.code}?pv=${PV}&role=host&tok=${playerToken()}${q}`);
  hostWs = ws;
  let retried = false;
  const retry = () => {
    // Putus di tengah jalan: coba sambung ulang ke room yang sama selama ~55 detik (server menahan room 60 detik).
    if (mine !== session || retried) return;
    retried = true;
    window.clearInterval(pingTimer);
    const since = resumeSince || Date.now();
    if (Date.now() - since > 55000) {
      h.onLink?.(false);
      return h.onError(ERRORS["socket-closed"]);
    }
    net.down = true;
    h.onLink?.(true);
    window.setTimeout(() => connectHost(h, mine, 0, since), Math.min(3000, 600 + (Date.now() - since) / 8));
  };
  const addGuest = (id: number): Guest => {
    const conn: Conn = {
      get open() {
        return ws.readyState === 1;
      },
      send: (msg) => ws.readyState === 1 && ws.send(JSON.stringify({ to: id, m: msg })),
      close: () => ws.readyState === 1 && ws.send(JSON.stringify({ kick: id })),
    };
    const g: Guest = { id, conn, bits: 0, aim: null, seen: performance.now(), ping: -1, v: 1, dropped: false, peer: false, emoteAt: 0 };
    net.guests.set(id, g);
    h.onJoin(id);
    return g;
  };
  ws.onopen = () => {
    if (mine !== session) return;
    net.ready = true;
    if (net.down) {
      net.down = false;
      h.onLink?.(false);
    }
    if (lobby.want) lobbyJoin();
    // Ping tiap 3 detik (juga menjaga sambungan hidup); tiap ~15 detik denyut untuk daftar room terbuka.
    let beat = 0;
    sendPing(ws);
    pingTimer = window.setInterval(() => {
      sendPing(ws);
      if (++beat % 5 === 0 && ws.readyState === 1) ws.send('{"hb":1}');
    }, 3000);
  };
  ws.onmessage = (e) => {
    if (mine !== session || typeof e.data !== "string") return;
    if (e.data === "pong") return onPong();
    let m: { t?: string; type?: string; s?: string; id?: number; m?: unknown; live?: number[]; held?: number[] };
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.t === "err") {
      if (m.type === "unavailable-id" && attempt < 5 && !resume) {
        hostWs = null;
        ws.onclose = null;
        ws.close();
        hostRoomWs(h, attempt + 1);
      } else {
        retried = true; // jangan coba sambung ulang setelah ditolak
        h.onError(ERRORS[m.type ?? ""] ?? "Ada masalah sambungan.");
      }
      return;
    }
    if (m.t === "demoted") {
      retried = true; // jangan sambung ulang sebagai host
      ws.onclose = null;
      ws.close();
      roleHandlers?.demote();
      return;
    }
    if (m.s === "lb") return adoptLobby(m);
    if (m.s === "lbnack") return lobbyNack((m as { why?: unknown }).why);
    if (m.s === "sync") {
      // Setelah sambung ulang: samakan daftar tamu dengan keadaan server.
      const live = new Set(Array.isArray(m.live) ? m.live : []);
      const held = new Set(Array.isArray(m.held) ? m.held : []);
      for (const id of Array.from(net.guests.keys())) {
        if (!live.has(id) && !held.has(id)) {
          net.guests.delete(id);
          h.onLeave(id);
        }
      }
      for (const id of live) {
        const g = net.guests.get(id);
        if (!g) addGuest(id);
        else if (g.dropped) {
          g.dropped = false;
          h.onBack(id);
        }
      }
      for (const id of held) {
        const g = net.guests.get(id);
        if (g && !g.dropped) {
          g.dropped = true;
          g.bits = 0;
          h.onDrop(id);
        }
      }
      return;
    }
    const id = m.id;
    if (typeof id !== "number") return;
    if (m.s === "join") addGuest(id);
    else if (m.s === "drop") {
      const g = net.guests.get(id);
      if (g && !g.dropped) {
        g.dropped = true;
        g.bits = 0;
        h.onDrop(id);
      }
    } else if (m.s === "back") {
      const g = net.guests.get(id);
      if (!g) addGuest(id);
      else {
        g.dropped = false;
        g.seen = performance.now();
        h.onBack(id);
      }
    } else if (m.s === "leave") {
      if (net.guests.delete(id)) h.onLeave(id);
    } else if (m.s === "msg") {
      const g = net.guests.get(id);
      if (g) onGuestData(g, m.m, h);
    }
  };
  ws.onclose = () => {
    if (mine === session && !retried) retry();
  };
  ws.onerror = () => {
    if (mine === session && !net.ready) {
      retried = true;
      h.onError(ERRORS["ws-failed"]);
    }
  };
}

// ===== Tamu lewat server perantara (WebSocket) =====
function joinRoomWs(code: string, h: ClientHandlers): void {
  const mine = session;
  net.role = "client";
  net.code = code;
  let done = false;
  const fail = (text: string) => {
    if (mine !== session || done) return;
    done = true;
    closeNet();
    h.onClose(text);
  };
  const ws = new WebSocket(`${SERVER}/ws/${code}?pv=${PV}&role=guest&tok=${playerToken()}`);
  hostWs = ws;
  hostConn = {
    get open() {
      return ws.readyState === 1;
    },
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
  };
  const timeout = window.setTimeout(() => {
    if (!net.ready) fail("Tidak bisa tersambung ke room.");
  }, 12000);
  ws.onopen = () => {
    sendPing(ws);
    pingTimer = window.setInterval(() => sendPing(ws), 3000);
  };
  ws.onmessage = (e) => {
    if (mine !== session || typeof e.data !== "string") return;
    if (e.data === "pong") return onPong();
    let m: { t?: string; type?: string; id?: number; s?: string } | null;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    // Setelah dijadikan host oleh server, soket ini menerima format host sebelum sempat disambung ulang.
    if (m?.s === "lb") return adoptLobby(m);
    if (m?.s === "lbnack") return lobbyNack((m as { why?: unknown }).why);
    if (m?.s) return;
    if (m?.t === "err") {
      window.clearTimeout(timeout);
      fail(ERRORS[m.type ?? ""] ?? "Ada masalah sambungan.");
      return;
    }
    onHostMsg(m, (t) => (window.clearTimeout(timeout), fail(t)), () => window.clearTimeout(timeout));
  };
  const lost = () => {
    window.clearTimeout(timeout);
    fail("Sambungan ke host putus.");
  };
  ws.onclose = lost;
  ws.onerror = lost;
}

// ===== Host =====
export async function hostRoom(h: HostHandlers, attempt = 0, opts?: HostOptions): Promise<void> {
  if (attempt === 0) {
    closeNet();
    lobby.want = !!SERVER; // dengan server perantara, lobi dipegang server
    lobby.pid = 0;
  }
  if (opts) hostOpts = opts;
  if (SERVER) return hostRoomWs(h, attempt);
  const mine = session;
  net.role = "host";
  net.code = randomCode();
  nextGuest = 1;
  let PeerCtor: typeof Peer;
  try {
    PeerCtor = (await import("peerjs")).Peer;
  } catch {
    if (mine === session) h.onError("Gagal memuat modul online.");
    return;
  }
  if (mine !== session) return;
  const p = new PeerCtor(PREFIX + net.code);
  peer = p;
  p.on("open", () => {
    if (mine === session) net.ready = true;
  });
  p.on("error", (err) => {
    if (mine !== session) return;
    const type = (err as { type?: string }).type ?? "";
    if (type === "unavailable-id" && attempt < 5) {
      // Kodenya sedang dipakai room lain: ambil kode baru.
      p.destroy();
      void hostRoom(h, attempt + 1, hostOpts);
      return;
    }
    if (type === "peer-unavailable") return; // bukan urusan host
    h.onError(ERRORS[type] ?? "Ada masalah sambungan.");
  });
  p.on("disconnected", () => {
    // Putus dari server perantara: tamu yang sudah masuk tetap tersambung, tapi tamu
    // baru tidak bisa masuk sampai tersambung lagi.
    if (mine === session && !p.destroyed) p.reconnect();
  });
  p.on("connection", (conn) => {
    if (mine !== session) return;
    conn.on("open", () => {
      if (mine !== session) return;
      if (net.guests.size >= MAX_GUESTS) {
        conn.send({ t: "full" });
        window.setTimeout(() => conn.close(), 300);
        return;
      }
      const g: Guest = { id: nextGuest++, conn, bits: 0, aim: null, seen: performance.now(), ping: -1, v: 1, dropped: false, peer: true, emoteAt: 0 };
      net.guests.set(g.id, g);
      conn.send({ t: "hi", id: g.id });
      h.onJoin(g.id);
      const leave = () => {
        if (mine !== session || net.guests.get(g.id) !== g) return;
        net.guests.delete(g.id);
        h.onLeave(g.id);
      };
      conn.on("close", leave);
      conn.on("error", leave);
      conn.on("data", (raw) => onGuestData(g, raw, h));
    });
  });
}

// Dipanggil tiap frame oleh host: buang tamu yang lama tidak berkabar (misalnya HP-nya
// mati layar), karena penutupan sambungan tidak selalu dilaporkan browser.
export function sweepGuests(): void {
  const now = performance.now();
  for (const g of Array.from(net.guests.values())) {
    // Lewat server perantara, server yang mengecek soket mati (dan menahan kursinya); hanya PeerJS dicek di sini.
    if (g.peer && now - g.seen > GUEST_TIMEOUT) g.conn.close();
  }
}

export function broadcast(msg: unknown): void {
  if (hostWs) {
    if (hostWs.readyState === 1 && net.guests.size > 0) hostWs.send(JSON.stringify({ m: msg }));
    return;
  }
  for (const g of net.guests.values()) {
    if (!g.conn.open) continue;
    try {
      g.conn.send(msg);
    } catch {
      // sambungannya sedang menutup
    }
  }
}

// Frame boleh digabung hanya bila semua tamu paham (tamu lama dari cache tidak mengerti "fb").
export const allGuestsBatch = () => Array.from(net.guests.values()).every((g) => g.v >= 2);
export const guestBits = (id: number) => net.guests.get(id)?.bits ?? 0;
export const guestAim = (id: number) => net.guests.get(id)?.aim ?? null;

// ===== Tamu =====
export async function joinRoom(code: string, h: ClientHandlers): Promise<void> {
  closeNet();
  lobby.want = !!SERVER;
  if (SERVER) return joinRoomWs(code, h);
  const mine = session;
  net.role = "client";
  net.code = code;
  let done = false;
  const fail = (text: string) => {
    if (mine !== session || done) return;
    done = true;
    closeNet();
    h.onClose(text);
  };
  let PeerCtor: typeof Peer;
  try {
    PeerCtor = (await import("peerjs")).Peer;
  } catch {
    return fail("Gagal memuat modul online.");
  }
  if (mine !== session) return;
  const p = new PeerCtor();
  peer = p;
  const timeout = window.setTimeout(() => {
    if (!net.ready) fail("Tidak bisa tersambung ke host. Jaringan ini mungkin memblokir sambungan langsung.");
  }, 20000);
  p.on("error", (err) => {
    const type = (err as { type?: string }).type ?? "";
    // Setelah tersambung ke host, server perantara tidak dibutuhkan lagi.
    if (net.ready && (type === "network" || type.startsWith("socket") || type === "server-error")) return;
    window.clearTimeout(timeout);
    fail(ERRORS[type] ?? "Ada masalah sambungan.");
  });
  p.on("open", () => {
    if (mine !== session) return;
    const conn = p.connect(PREFIX + code, { reliable: true, serialization: "json" });
    hostConn = conn;
    conn.on("data", (raw) => {
      if (mine !== session) return;
      onHostMsg(raw as { t?: string; id?: number } | null, (t) => (window.clearTimeout(timeout), fail(t)), () => window.clearTimeout(timeout));
    });
    conn.on("close", () => {
      window.clearTimeout(timeout);
      fail("Sambungan ke host putus.");
    });
    conn.on("error", () => {
      window.clearTimeout(timeout);
      fail("Sambungan ke host putus.");
    });
  });
}

export function sendToHost(msg: unknown): void {
  if (!hostConn?.open) return;
  try {
    hostConn.send(msg);
  } catch {
    // sambungannya sedang menutup
  }
}

// Host menutup room dengan sopan supaya tamu langsung tahu, tidak menunggu batas waktu.
export function leaveRoom(): void {
  if (net.role === "host") broadcast({ t: "bye" });
  closeNet();
}
