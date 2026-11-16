// Mabar online: sisi host dan sisi tamu (klien) di dalam game.
import { crowdSfx, sfx } from "./audio";
import { devices, mouse, spectator, type SpecDevice, readAll, readInput, type Device } from "./input";
import { EMOTE_COUNT, allGuestsBatch, broadcast, findMatch, setEmoteHandler, guestBits, joinRoom, listRooms, lobby, net, roomListEnabled, sendToHost, type GuestCommand } from "./net";
import { ARENAS, TIMES, type ArenaId, type TimeId } from "./scenery";
import { setTouchRole, touchState } from "./touch";
import { Btn, CHARS, DT, type GameEvent, type GameState } from "./sim";
import { account } from "./auth";
import { goLobby } from "./lobby";
import { SPEC_SEAT, ext, lobbyPlan, isPlayerSeat, startHosting, KEY_HELP, $, app, backBtn, callout, elHelp, elHud, elNetNote, excitement, guestGone, handleEvent, join, lockChar, renderControls, renderMenus, renderRoom, renderRoomClient, renderSelect, renderer, resetShown, room, roomPreview, seatKind, selectAct, setMode, setNetNote, startDemo, state, type Mode, ui, updateHud } from "./main";

// ===== Mabar online =====
// Host: tombol kursi online diambil dari tamu; keadaan game disiarkan tiap frame.
export function seatInput(i: 0 | 1): number {
  const d = devices[i];
  return d.kind === "net" ? guestBits(d.id) : readInput(i);
}

let idleFrames = 0;
export function hostBroadcastMaybe(stepped: boolean, events: GameEvent[]): void {
  if (stepped || ++idleFrames % 20 === 0) hostBroadcast(events, stepped);
}

// Dua frame digabung dalam satu pesan: jumlah pesan ke server separuhnya (biaya dan beban turun),
// tamu tetap memutar frame satu per satu. Frame yang tidak datang dari langkah simulasi
// (menu, jeda) langsung dikirim tanpa menunggu pasangan.
const BATCH = 2;
let pendingFrames: object[] = [];
function hostBroadcast(events: GameEvent[], stepped: boolean): void {
  if (net.guests.size === 0) {
    pendingFrames = [];
    return;
  }
  const seatOf = (d: SpecDevice) => (d.kind === "net" ? d.id : 0);
  pendingFrames.push({
    t: "f",
    m: app.mode === "pickchar" ? "room" : app.mode === "select" || app.mode === "match" || app.mode === "room" ? app.mode : "lobby",
    rc: room.chars.slice(0, 6),
    xs: ext.slice(),
    hk: Array.from({ length: 6 }, (_, i) => (i === 0 ? "h" : seatKind(i) === "bot" ? "b" : "g")).join(""),
    p: app.paused,
    seats: [seatOf(devices[0]), seatOf(devices[1]), seatOf(spectator.device)],
    chars: app.chars,
    locked: app.locked,
    ar: [renderer.arena, renderer.time],
    sk: renderer.skins,
    s: app.mode === "select" || app.mode === "match" || app.mode === "room" || app.mode === "pickchar" ? { ...state, events: [] } : undefined,
    ev: events,
    hp: Math.round(net.ping),
    ts: app.teamSize,
    ls: lobbyPlan.on ? lobbyPlan.pids : undefined,
    lh: lobbyPlan.on ? lobbyPlan.host : undefined,
  });
  if (stepped && pendingFrames.length < BATCH && allGuestsBatch()) return;
  const out = pendingFrames;
  pendingFrames = [];
  // Tamu lama (v1) tidak mengerti "fb": kirim satu-satu.
  if (out.length === 1) broadcast(out[0]);
  else if (allGuestsBatch()) broadcast({ t: "fb", f: out });
  else for (const f of out) broadcast(f);
}

// Kursi pemain milik tamu `id` (0..5), atau -1 kalau ia bukan pemain.
let autoPaused = false; // dijeda otomatis karena putus (bukan pilihan host)
const seatByGuest = (id: number): number => {
  if (lobbyPlan.on) return lobbyPlan.pids.indexOf(id);
  const d = devices.findIndex((x) => x.kind === "net" && x.id === id);
  return d >= 0 ? d : ext.findIndex((g, i) => i >= 2 && g === id);
};

// Menempatkan tamu: kursi 1 (lawan), lalu kursi tambahan sesuai format, lalu penonton.
// Kursi yang ditinggal tamu yang sudah putus dianggap kosong.
function placeGuest(id: number): void {
  const dev: Device = { kind: "net", id };
  if (guestGone(devices[0])) devices[0] = dev;
  else if (guestGone(devices[1])) devices[1] = dev;
  else {
    const lobby = app.mode === "controls" || app.mode === "room" || app.mode === "select";
    // Di lobi kursi kosong atau bekas tamu putus boleh diisi; di pertandingan hanya kursi bekas tamu yang putus (ia kembali).
    const free = [2, 3, 4, 5].find((k) => k < app.teamSize * 2 && (lobby ? ext[k] === 0 || !net.guests.has(ext[k]) : ext[k] !== 0 && !net.guests.has(ext[k])));
    if (free !== undefined) ext[free] = id;
    else if (guestGone(spectator.device)) spectator.device = dev;
    else if (app.mode === "controls" || app.mode === "room") {
      if (spectator.device.kind === "none" || spectator.device.kind === "auto") spectator.device = dev;
    }
  }
}

// Setelah format berubah: tamu yang kehilangan kursi jadi penonton/menonton, yang menonton dapat kursi kosong.
export function reseatGuests(): void {
  for (let k = 2; k < 6; k++) if (ext[k] !== 0 && (k >= app.teamSize * 2 || !net.guests.has(ext[k]))) ext[k] = 0;
  for (const id of net.guests.keys()) {
    const placed =
      devices.some((d) => d.kind === "net" && d.id === id) || ext.includes(id) || (spectator.device.kind === "net" && spectator.device.id === id);
    if (!placed) placeGuest(id);
  }
}

export const hostHandlers = {
  onJoin(id: number): void {
    if (lobby.want) {
      // Lobi dipegang server: kursi diatur di sana, bukan di sini.
      sfx.receivePerfect();
      setNetNote(`TAMU ${id} MASUK`, 2.5);
      return;
    }
    // Kursi yang ditinggal tamu putus diisi dulu; di lobi, tamu pertama jadi P2 dan
    // berikutnya mengisi kursi tim (sesuai format), lalu penonton. Host tetap bisa menukarnya.
    if (guestGone(devices[0]) || guestGone(devices[1])) placeGuest(id);
    else if (app.mode === "controls" || app.mode === "room") {
      if (app.humans === 2 && devices[1].kind !== "net") devices[1] = { kind: "net", id };
      else placeGuest(id);
    } else placeGuest(id);
    sfx.receivePerfect();
    setNetNote(`TAMU ${id} MASUK`, 2.5);
    if (app.mode === "room" && !ui.autoPicked && devices[1].kind === "net") {
      // Tamu masuk: kursi host langsung dibuka untuk memilih jagoan.
      ui.autoPicked = true;
      room.focus = "s0";
      room.edit = 0;
      room.grid = true;
      renderRoom();
      return;
    }
    if (app.mode === "room") renderRoom();
    else if (app.mode === "controls") renderControls();
    else if (app.mode === "select") renderSelect();
  },
  onLeave(id: number): void {
    const seat = seatByGuest(id);
    for (let k = 2; k < 6; k++) if (ext[k] === id && app.mode !== "match") ext[k] = 0; // di pertandingan, kursinya dipegang bot sampai tamu kembali
    setNetNote(`TAMU ${id} PUTUS`, 4);
    sfx.fault();
    if (app.mode === "room") renderRoom();
    else if (app.mode === "controls") renderControls();
    else if (app.mode === "match" && seat >= 0 && state.phase !== "over" && !app.paused) {
      // Pemainnya hilang: jeda dulu. Kalau ia masuk lagi, kursinya otomatis kembali.
      app.paused = true;
      app.pauseIndex = 0;
      elHud.dataset.paused = "1";
      renderMenus();
    }
  },
  onDrop(id: number): void {
    // Putus sementara: kursinya ditahan. Di pertandingan, game dijeda sampai ia kembali (atau masa tunggu habis).
    const seat = seatByGuest(id);
    setNetNote(`TAMU ${id} TERPUTUS · KURSI DITAHAN`, 6);
    sfx.fault();
    if (app.mode === "room") renderRoom();
    else if (app.mode === "controls") renderControls();
    else if (app.mode === "match" && seat >= 0 && state.phase !== "over" && !app.paused) {
      app.paused = true;
      app.pauseIndex = 0;
      autoPaused = true;
      elHud.dataset.paused = "1";
      renderMenus();
    }
  },
  onBack(id: number): void {
    setNetNote(`TAMU ${id} KEMBALI`, 2.5);
    sfx.receivePerfect();
    // Dijeda karena tamu putus dan tak ada lagi yang putus: lanjut sendiri.
    if (autoPaused && app.mode === "match" && !Array.from(net.guests.values()).some((g) => g.dropped)) {
      autoPaused = false;
      app.paused = false;
      elHud.dataset.paused = "0";
      renderMenus();
    }
    if (app.mode === "room") renderRoom();
    else if (app.mode === "controls") renderControls();
  },
  onLink(down: boolean): void {
    // Sambungan host ke server putus: jeda pertandingan dan menyambung ulang otomatis.
    if (down) {
      setNetNote("KONEKSI TERPUTUS · MENYAMBUNG ULANG…");
      if (app.mode === "match" && !app.paused && state.phase !== "over") {
        app.paused = true;
        app.pauseIndex = 0;
        autoPaused = true;
        elHud.dataset.paused = "1";
        renderMenus();
      }
    } else {
      setNetNote("KONEKSI PULIH", 2.5);
      if (autoPaused && app.mode === "match" && !Array.from(net.guests.values()).some((g) => g.dropped)) {
        autoPaused = false;
        app.paused = false;
        elHud.dataset.paused = "0";
        renderMenus();
      }
    }
  },
  onEmote(id: number, k: number): void {
    const seat = seatByGuest(id);
    if (app.mode !== "match" || !isPlayerSeat(seat)) return;
    showEmote(seat, k);
    broadcast({ t: "emo", s: seat, k });
  },
  onCommand(id: number, cmd: GuestCommand): void {
    const seat = seatByGuest(id);
    // Di Room: tamu memilih jagoan untuk kursinya sendiri dari halaman Pilih Jagoan.
    if ((app.mode === "room" || app.mode === "pickchar") && isPlayerSeat(seat) && cmd.c === "char") {
      if (cmd.k >= 0 && cmd.k < CHARS.length && seatKind(seat) !== "bot") {
        room.chars[seat] = cmd.k;
        room.skins[seat] = 0;
        roomPreview();
        if (app.mode === "room") renderRoom();
      }
      return;
    }
    if (app.mode !== "select" || seat < 0 || seat > 1) return;
    const who = seat as 0 | 1;
    if (cmd.c === "char") {
      if (app.locked[who] || cmd.k < 0 || cmd.k >= CHARS.length) return;
      if (app.chars[who] === cmd.k) return lockChar(who);
      app.chars[who] = cmd.k;
      state.chars[who] = cmd.k;
      sfx.swing();
      renderSelect();
    } else selectAct(who, cmd.c);
  },
  onError(text: string): void {
    ui.roomError = text;
  },
};

// ----- Tamu -----
// ===== Cari lawan cepat =====
// Antre di server; begitu dipasangkan, satu orang jadi host dan yang lain masuk ke room-nya.
let cancelSearch: (() => void) | null = null;
export function stopSearch(): void {
  cancelSearch?.();
  cancelSearch = null;
}

export function goQuickMatch(): void {
  stopSearch();
  setMode("join");
  join.status = "searching";
  join.text = "";
  renderJoin();
  let waited = 0;
  const tick = window.setInterval(() => {
    if (app.mode !== "join" || join.status !== "searching") return window.clearInterval(tick);
    waited++;
    renderJoin();
    if (waited >= 90) {
      stopSearch();
      window.clearInterval(tick);
      join.status = "error";
      join.text = "Belum ada lawan. Coba lagi sebentar, atau buat room dan ajak teman.";
      renderJoin();
    }
  }, 1000);
  cancelSearch = findMatch({
    onMatch(role, code) {
      cancelSearch = null;
      window.clearInterval(tick);
      if (app.mode !== "join") return;
      if (role === "host") startHosting(false, code);
      else goJoin(code, true);
    },
    onError(text) {
      cancelSearch = null;
      window.clearInterval(tick);
      join.status = "error";
      join.text = text;
      if (app.mode === "join") renderJoin();
    },
  });
}

let quickTries = 0;
export function goJoin(code: string, quick = false): void {
  setMode("join");
  if (code.length !== 4) {
    join.status = "input";
    join.text = "";
    renderJoin();
    return;
  }
  if (!quick) quickTries = 0;
  app.online = "client";
  lobby.name = account.profile?.displayName ?? "Pemain";
  ui.autoPicked = false;
  app.seat = -1;
  app.teamSize = 1;
  app.mate = false;
  app.humans = 2;
  app.training = false;
  join.status = "connecting";
  join.text = code;
  renderJoin();
  const wasPlaying = () => net.myId >= 0;
  void joinRoom(code, {
    onClose(text) {
      // Baru dipasangkan: host mungkin belum selesai membuka room, jadi coba lagi sebentar.
      if (quick && text.startsWith("Room tidak ditemukan") && quickTries < 8) {
        quickTries++;
        app.online = "off";
        window.setTimeout(() => {
          if (app.mode === "join" && app.online === "off") goJoin(code, true);
        }, 800);
        return;
      }
      // Putus di tengah jalan: coba sambung ulang beberapa kali sebelum menyerah. Host
      // mengembalikan kursimu begitu kamu masuk lagi.
      const dropped = text.startsWith("Sambungan ke host putus") && hadSeat;
      app.online = "off";
      app.seat = -1;
      mouse.capture = false;
      setNetNote("");
      setMode("join");
      startDemo();
      if (dropped && rejoinTries < 25) {
        rejoinTries++;
        join.status = "connecting";
        join.text = code;
        renderJoin();
        $("joinBox").innerHTML += `<br />Sambungan putus. Menyambung ulang (${rejoinTries})…`;
        window.setTimeout(() => {
          if (app.mode === "join" && app.online === "off" && join.status === "connecting") goJoin(code);
        }, 1500);
        return;
      }
      rejoinTries = 0;
      join.status = "error";
      join.text = text;
      renderJoin();
    },
  });
  // Dicatat lewat pemeriksaan berkala: begitu host memberi nomor, sambungan ini dianggap pernah hidup.
  let hadSeat = false;
  const watch = window.setInterval(() => {
    if (app.online !== "client") return window.clearInterval(watch);
    if (wasPlaying()) {
      hadSeat = true;
      if (app.mode !== "join") rejoinTries = 0;
    }
  }, 500);
}

// Panel merah dengan dua slot (aset buatan Gemini): judul di slot atas, isi di slot bawah.
export const jpanel = (top: string, bottom: string, cls = "") =>
  `<div class="jpanel ${cls}"><div class="jtop display">${top}</div><div class="jbot">${bottom}</div></div>`;

// Daftar room terbuka di bawah kotak kode: tap satu untuk langsung masuk.
let listToken = 0;
const escapeText = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function refreshRoomList(): void {
  const box = document.getElementById("roomList");
  if (!box || !roomListEnabled) return;
  const mine = ++listToken;
  box.innerHTML = `<small>Mencari room terbuka…</small>`;
  void listRooms().then((rooms) => {
    const el = document.getElementById("roomList");
    if (mine !== listToken || !el || app.mode !== "join") return;
    const refresh = `<span class="tapbtn" data-tap="rooms">SEGARKAN</span>`;
    el.innerHTML = rooms.length
      ? `<small>ROOM TERBUKA</small>` +
        rooms.map((r) => `<span class="tapbtn go" data-tap="joinroom:${r.code}">${escapeText(r.name)} · ${r.code} · ${r.guests} tamu ▸</span>`).join("") +
        refresh
      : `<small>Belum ada room terbuka. Buat satu lewat BUAT ROOM TERBUKA.</small>${refresh}`;
  });
}

const seatName = (seat: number) => (seat === SPEC_SEAT ? "PENONTON USIL" : `PEMAIN ${seat + 1}`);
function renderJoin(): void {
  const back = backBtn();
  if (join.status === "input" || join.status === "error") {
    $("joinBox").innerHTML =
      jpanel(
        "KETIK KODE ROOM DARI HOST",
        `<input id="roomInput" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" />`,
      ) +
      `<span class="tapbtn go" data-tap="join">GABUNG ▸</span>` +
      (join.status === "error" ? `<br /><span class="bad">${join.text}</span>` : "") +
      (roomListEnabled ? `<div id="roomList" class="rlist"></div>` : "");
    if (roomListEnabled) refreshRoomList();
    $("joinHint").innerHTML = back;
    if (!touchState.enabled) (document.getElementById("roomInput") as HTMLInputElement | null)?.focus();
    return;
  }
  if (join.status === "searching") {
    $("joinBox").innerHTML = jpanel("MENCARI LAWAN…", "Menunggu pemain lain yang juga mencari. Tahan sebentar, ya.");
  } else if (join.status === "connecting") {
    $("joinBox").innerHTML = jpanel(`ROOM ${join.text}`, "Menyambung ke host…");
  } else {
    const seat =
      app.seat >= 0
        ? `Kursimu: <b>${seatName(app.seat)}</b><br />Menunggu host memulai…`
        : `Kamu belum dapat kursi, jadi menonton dulu.<br />Menunggu host memulai…`;
    $("joinBox").innerHTML = jpanel(`TERHUBUNG · ROOM ${net.code}`, seat);
  }
  $("joinHint").innerHTML = back;
}

interface FrameMsg {
  t: "f";
  m: "lobby" | "select" | "match" | "room";
  rc?: number[]; // jagoan di Room (kursi 1 dan 2)
  p: boolean;
  seats: number[];
  ar?: [ArenaId, TimeId];
  sk?: number[]; // skin tiap kursi (tampilan saja)
  chars: [number, number];
  locked: [boolean, boolean];
  s?: GameState;
  ev: GameEvent[];
  hp?: number; // ping host ke server perantara (ms)
  ts?: 1 | 2 | 3; // pemain per sisi (format 1v1, 2v2, 3v3)
  xs?: number[]; // nomor tamu pemain di kursi 0..5 (0 = bukan tamu)
  hk?: string; // jenis tiap kursi: h host, g tamu, b bot
  ls?: number[]; // pertandingan dari lobi server: nomor pemain di tiap kursi (-1 bot)
  lh?: number; // nomor pemain yang jadi host
}

function clientHelp(): void {
  setTouchRole(app.seat === SPEC_SEAT ? "spec" : app.seat >= 0 ? "player" : "off");
  const text =
    app.seat === SPEC_SEAT
      ? touchState.enabled
        ? "<b>KAMU PENONTON USIL</b> stik geser bidikan · SMASH kulit pisang · LOMPAT sandal"
        : "<b>KAMU PENONTON USIL</b> mouse membidik · klik kiri kulit pisang · klik kanan sandal (atau C B geser, V pisang, Spasi sandal)"
      : app.seat >= 0
        ? `<b>KAMU P${app.seat + 1}</b> ${KEY_HELP[0]()}`
        : "<b>KAMU MENONTON</b>";
  elHelp.innerHTML = `${text} &nbsp;·&nbsp; <kbd>Esc</kbd> menu`;
}

let hostPing = -1;
function applyFrame(m: FrameMsg): void {
  hostPing = typeof m.hp === "number" ? m.hp : -1;
  if (m.ts === 1 || m.ts === 2 || m.ts === 3) app.teamSize = m.ts;
  if (
    Array.isArray(m.ar) &&
    ARENAS.some((a) => a.id === m.ar![0]) &&
    TIMES.some((t) => t.id === m.ar![1])
  ) {
    renderer.setArena(m.ar[0], m.ar[1]);
  }
  // Skin dari host: hanya angka 0..2, paling banyak 6 kursi.
  if (Array.isArray(m.sk)) renderer.skins = m.sk.slice(0, 6).map((x) => (x === 1 || x === 2 ? x : 0));
  let seat = Array.isArray(m.seats) ? m.seats.indexOf(net.myId) : -1;
  if (seat === 2) seat = SPEC_SEAT;
  else if (seat < 0 && Array.isArray(m.xs)) {
    const k = m.xs.indexOf(net.myId);
    if (k >= 2) seat = k;
  }
  if (Array.isArray(m.ls)) {
    // Kursi dari lobi server menggantikan perhitungan kursi lama.
    const ls = m.ls.slice(0, 6).map((x) => (Number.isInteger(x) ? x : -1));
    seat = ls.indexOf(net.myId >= 0 ? net.myId : lobby.pid);
    m.hk = ls.map((p) => (p < 0 ? "b" : p === m.lh ? "h" : "g")).join("");
  }
  if (typeof m.hk === "string") ui.hk = m.hk.slice(0, 6);
  const seatChanged = seat !== app.seat;
  app.seat = seat;
  const pickChanged =
    m.chars[0] !== app.chars[0] || m.chars[1] !== app.chars[1] || m.locked[0] !== app.locked[0] || m.locked[1] !== app.locked[1];
  app.chars = [m.chars[0] | 0, m.chars[1] | 0];
  app.locked = [m.locked[0] === true, m.locked[1] === true];
  let restarted = false;
  if (m.s) {
    restarted = m.s.frame < state.frame;
    Object.assign(state, m.s);
    state.events = [];
  }
  const want: Mode = m.m === "match" || m.m === "select" || m.m === "room" ? m.m : m.m === "lobby" && lobby.view ? "lobby" : "join";
  // Jagoan di Room dari host (kursi 1 dan 2).
  let roomChanged = false;
  if (Array.isArray(m.rc) && m.rc.length >= 2) {
    for (let i = 0; i < Math.min(6, m.rc.length); i++) {
      const k = Math.max(0, Math.min(CHARS.length - 1, Number(m.rc[i]) | 0));
      if (room.chars[i] !== k) {
        room.chars[i] = k;
        roomChanged = true;
      }
    }
  }
  if (want === "room" && app.mode === "pickchar") {
    // Tamu sedang di halaman Pilih Jagoan: biarkan, kembali ke Room setelah memilih.
  } else if (want !== app.mode) {
    const wasPaused = app.paused;
    setMode(want);
    if (wasPaused && want !== "join") {
      app.paused = true;
      elHud.dataset.paused = "1";
    }
    if (want === "lobby") goLobby();
    else if (want === "match") {
      resetShown();
      clientHelp();
      callout(app.seat === SPEC_SEAT ? "KAMU PENONTON USIL!" : app.seat >= 0 ? `KAMU P${app.seat + 1}!` : "MULAI!", "#ffd23f", true);
    } else if (want === "select") renderSelect();
    else if (want === "room") {
      if (!ui.autoPicked && isPlayerSeat(app.seat)) {
        ui.autoPicked = true;
        room.edit = app.seat;
        room.grid = true;
      }
      renderRoomClient();
    } else {
      join.status = "waiting";
      renderJoin();
    }
  } else if (want === "room" && (roomChanged || seatChanged)) {
    if (app.mode === "room") {
      if (!ui.autoPicked && isPlayerSeat(app.seat)) {
        ui.autoPicked = true;
        room.edit = app.seat;
        room.grid = true;
      }
      renderRoomClient();
    }
  } else if (want === "match" && (restarted || seatChanged)) {
    if (restarted) resetShown();
    clientHelp();
  } else if (want === "select" && (pickChanged || seatChanged)) renderSelect();
  else if (want === "join" && seatChanged) renderJoin();
  hostPaused = m.p === true;
  if (app.mode === "match" && Array.isArray(m.ev)) {
    for (const e of m.ev) {
      handleEvent(e);
      renderer.handleEvent(e, state);
    }
  }
}

let hostPaused = false;
let clientAcc = 0;
let clientLast = performance.now();
let rejoinTries = 0;
let sentBits = -1;
let sentAim: number | null = null;
let sentAt = 0;
let keyAimAt = 0; // nilai mouse.moved saat bidikan terakhir digeser pakai tombol

export function clientUpdate(now: number): void {
  if (net.ready && join.status === "connecting") {
    join.status = "waiting";
    renderJoin();
  }
  // Penyangga kecil: kiriman host sering datang bergerombol. Daripada menampilkan semuanya
  // sekaligus (gerakan jadi loncat-loncat), diputar satu per satu seirama 60 kali per detik,
  // dan baru dikejar kalau tumpukannya terlalu panjang.
  clientAcc = Math.min(0.1, clientAcc + Math.max(0, (now - clientLast) / 1000));
  clientLast = now;
  let budget = Math.floor(clientAcc / DT);
  clientAcc -= budget * DT;
  if (net.inbox.length > 6) budget = Math.max(budget, net.inbox.length - 2);
  if (app.mode !== "match") budget = net.inbox.length; // di menu tidak perlu dihaluskan
  while (budget-- > 0 && net.inbox.length > 0) {
    const m = net.inbox.shift() as FrameMsg;
    if (m.t !== "f" || !Array.isArray(m.chars) || !Array.isArray(m.locked)) continue;
    try {
      applyFrame(m);
    } catch {
      // pesan rusak: lewati, tunggu yang berikutnya
    }
  }

  // Kirim tombol ke host: tiap ada perubahan, plus kabar berkala supaya tidak dianggap putus.
  const spec = app.seat === SPEC_SEAT;
  const playing = app.mode === "match" && app.seat >= 0 && !app.paused;
  mouse.capture = spec && playing;
  const bits = playing ? readAll(spec) : 0;
  let aim: number | null = null;
  if (spec && playing && !touchState.enabled) {
    if (bits & (Btn.LEFT | Btn.RIGHT)) keyAimAt = mouse.moved;
    if (mouse.moved !== keyAimAt) aim = Math.round(renderer.worldX(mouse.x, mouse.y) * 100) / 100;
  }
  if (net.ready && (bits !== sentBits || aim !== sentAim || now - sentAt > 500)) {
    sentBits = bits;
    sentAim = aim;
    sentAt = now;
    const p = net.ping >= 0 ? Math.round(net.ping) : undefined;
    sendToHost(aim === null ? { t: "i", b: bits, p, v: 2 } : { t: "i", b: bits, x: aim, p, v: 2 });
  }

  if (net.ready && app.mode !== "join") {
    const stale = performance.now() - net.lastHeard > 1500;
    const note = net.down ? "HOST TERPUTUS · MENUNGGU…" : stale ? "SAMBUNGAN TERSENDAT…" : hostPaused && app.mode === "match" ? "HOST MENJEDA" : "";
    if (elNetNote.textContent !== note) setNetNote(note);
  }

  updateOnlineHud();
  const inMatch = app.mode === "match";
  const excite = inMatch ? excitement() : 0.12;
  crowdSfx.level(excite);
  if (inMatch) updateHud();
  renderer.draw(state, excite);
}


// ===== Emote dan ping =====
// Emote dikirim ke host, host menyiarkannya ke semua. Hanya pemain yang duduk (bukan penonton) boleh mengirim.
export const EMOTES: readonly { e: string; t: string }[] = [
  { e: "👍", t: "MANTAP" },
  { e: "😂", t: "WKWK" },
  { e: "🔥", t: "PANAS" },
  { e: "👏", t: "GG" },
  { e: "😮", t: "WAH!" },
  { e: "🙏", t: "SABAR" },
];
if (EMOTES.length !== EMOTE_COUNT) throw new Error("EMOTE_COUNT tidak cocok dengan EMOTES");

const bubbleTimer = [0, 0];
function showEmote(seat: number, k: number): void {
  if (!isPlayerSeat(seat)) return;
  const side = seat & 1; // bubble muncul di sisi timnya
  const el = document.getElementById(`emoteB${side}`);
  const em = EMOTES[k];
  if (!el || !em) return;
  el.innerHTML = `${em.e}<b>${em.t}</b>`;
  el.classList.remove("on");
  void el.offsetWidth; // mulai ulang animasinya
  el.classList.add("on");
  window.clearTimeout(bubbleTimer[side]);
  bubbleTimer[side] = window.setTimeout(() => el.classList.remove("on"), 2300);
}
setEmoteHandler(showEmote);

let emoteSentAt = 0;
export function sendEmote(k: number): void {
  const now = performance.now();
  if (app.mode !== "match" || app.online === "off" || k < 0 || k >= EMOTE_COUNT || now - emoteSentAt < 1500) return;
  if (app.online === "client") {
    if (!isPlayerSeat(app.seat)) return;
    emoteSentAt = now;
    sendToHost({ t: "emo", k });
    return;
  }
  const seat = devices[0].kind === "net" ? 1 : 0; // kursi host: yang bukan milik tamu
  emoteSentAt = now;
  showEmote(seat, k);
  broadcast({ t: "emo", s: seat, k });
}

// Ping total = jarak ke server (host) + jarak ke server (tamu), dalam milidetik.
let pingShown = "";
let emotesShown = false;
export function updateOnlineHud(): void {
  const tag = document.getElementById("pingTag");
  const bar = document.getElementById("emotes");
  if (!tag || !bar) return;
  let text = "";
  let cls = "";
  if (app.mode === "match" && app.online !== "off" && net.ready && net.ping >= 0) {
    let total = net.ping;
    if (app.online === "client") total += hostPing >= 0 ? hostPing : 0;
    else {
      const worst = Math.max(-1, ...Array.from(net.guests.values(), (g) => g.ping));
      if (worst >= 0) total += worst;
    }
    const ms = Math.round(total);
    text = `PING ${ms}`;
    cls = ms < 90 ? "ok" : ms < 180 ? "mid" : "bad";
  }
  const key = text + cls;
  if (key !== pingShown) {
    pingShown = key;
    tag.textContent = text;
    tag.className = cls + (text ? " on" : "");
  }
  const canEmote = app.mode === "match" && app.online !== "off" && (app.online === "host" || isPlayerSeat(app.seat));
  if (canEmote !== emotesShown) {
    emotesShown = canEmote;
    bar.classList.toggle("on", canEmote);
  }
}
