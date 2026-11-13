import type { DataConnection, Peer } from "peerjs";

// Mabar online. Satu perangkat jadi host: ia menjalankan simulasi dan mengirim keadaan
// game ke tamu. Tamu hanya mengirim tombol yang ditekan dan menggambar apa yang diterima.
// PeerJS dipakai untuk mempertemukan perangkat lewat kode room; datanya sendiri mengalir
// langsung antar-perangkat (WebRTC). Modulnya dimuat belakangan supaya game biasa tetap ringan.

const PREFIX = "takrawclash-v1-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // tanpa I dan O supaya tidak tertukar angka
export const MAX_GUESTS = 4;
const GUEST_TIMEOUT = 6000; // ms tanpa kabar sebelum tamu dianggap putus

export interface Guest {
  id: number;
  conn: DataConnection;
  bits: number;
  aim: number | null; // bidikan penonton dari mouse, dalam koordinat lapangan
  seen: number;
}

export type GuestCommand = { c: "left" | "right" | "lock" } | { c: "char"; k: number };

export interface HostHandlers {
  onJoin(id: number): void;
  onLeave(id: number): void;
  onCommand(id: number, cmd: GuestCommand): void;
  onError(text: string): void;
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
};

let peer: Peer | null = null;
let hostConn: DataConnection | null = null;
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
  try {
    peer?.destroy();
  } catch {
    // sudah mati
  }
  peer = null;
  hostConn = null;
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
};

// ===== Host =====
export async function hostRoom(h: HostHandlers, attempt = 0): Promise<void> {
  if (attempt === 0) closeNet();
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
      void hostRoom(h, attempt + 1);
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
      const g: Guest = { id: nextGuest++, conn, bits: 0, aim: null, seen: performance.now() };
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
      conn.on("data", (raw) => {
        // Data dari luar: jangan percaya bentuknya.
        const m = raw as { t?: unknown; b?: unknown; x?: unknown; c?: unknown; k?: unknown } | null;
        if (!m || typeof m !== "object") return;
        g.seen = performance.now();
        if (m.t === "i") {
          g.bits = typeof m.b === "number" ? m.b & 0x1ff : 0;
          g.aim = typeof m.x === "number" && Number.isFinite(m.x) ? m.x : null;
        } else if (m.t === "cmd") {
          if (m.c === "left" || m.c === "right" || m.c === "lock") h.onCommand(g.id, { c: m.c });
          else if (m.c === "char" && typeof m.k === "number" && Number.isInteger(m.k)) h.onCommand(g.id, { c: "char", k: m.k });
        }
      });
    });
  });
}

// Dipanggil tiap frame oleh host: buang tamu yang lama tidak berkabar (misalnya HP-nya
// mati layar), karena penutupan sambungan tidak selalu dilaporkan browser.
export function sweepGuests(): void {
  const now = performance.now();
  for (const g of Array.from(net.guests.values())) {
    if (now - g.seen > GUEST_TIMEOUT) g.conn.close();
  }
}

export function broadcast(msg: unknown): void {
  for (const g of net.guests.values()) {
    if (!g.conn.open) continue;
    try {
      g.conn.send(msg);
    } catch {
      // sambungannya sedang menutup
    }
  }
}

export const guestBits = (id: number) => net.guests.get(id)?.bits ?? 0;
export const guestAim = (id: number) => net.guests.get(id)?.aim ?? null;

// ===== Tamu =====
export async function joinRoom(code: string, h: ClientHandlers): Promise<void> {
  closeNet();
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
      const m = raw as { t?: string; id?: number } | null;
      if (!m || typeof m !== "object") return;
      net.lastHeard = performance.now();
      if (m.t === "hi" && typeof m.id === "number") {
        net.myId = m.id;
        net.ready = true;
        window.clearTimeout(timeout);
      } else if (m.t === "full") {
        window.clearTimeout(timeout);
        fail("Room sudah penuh.");
      } else if (m.t === "bye") {
        fail("Host menutup room.");
      } else {
        net.inbox.push(m);
        if (net.inbox.length > 120) net.inbox.splice(0, net.inbox.length - 120);
      }
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
