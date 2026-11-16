// Mabar online: sisi host dan sisi tamu (klien) di dalam game.
import { crowdSfx, sfx } from "./audio";
import { devices, mouse, spectator, type SpecDevice, readAll, readInput, type Device } from "./input";
import { broadcast, guestBits, joinRoom, net, sendToHost, type GuestCommand } from "./net";
import { ARENAS, TIMES, type ArenaId, type TimeId } from "./scenery";
import { setTouchRole, touchState } from "./touch";
import { Btn, CHARS, DT, type GameEvent, type GameState } from "./sim";
import { KEY_HELP, $, app, backBtn, callout, elHelp, elHud, elNetNote, excitement, guestGone, handleEvent, join, lockChar, renderControls, renderMenus, renderRoom, renderRoomClient, renderSelect, renderer, resetShown, room, roomPreview, seatKind, selectAct, setMode, setNetNote, startDemo, state, type Mode, ui, updateHud } from "./main";

// ===== Mabar online =====
// Host: tombol kursi online diambil dari tamu; keadaan game disiarkan tiap frame.
export function seatInput(i: 0 | 1): number {
  const d = devices[i];
  return d.kind === "net" ? guestBits(d.id) : readInput(i);
}

let idleFrames = 0;
export function hostBroadcastMaybe(stepped: boolean, events: GameEvent[]): void {
  if (stepped || ++idleFrames % 20 === 0) hostBroadcast(events);
}
function hostBroadcast(events: GameEvent[]): void {
  if (net.guests.size === 0) return;
  const seatOf = (d: SpecDevice) => (d.kind === "net" ? d.id : 0);
  broadcast({
    t: "f",
    m: app.mode === "pickchar" ? "room" : app.mode === "select" || app.mode === "match" || app.mode === "room" ? app.mode : "lobby",
    rc: room.chars.slice(0, 2),
    p: app.paused,
    seats: [seatOf(devices[0]), seatOf(devices[1]), seatOf(spectator.device)],
    chars: app.chars,
    locked: app.locked,
    ar: [renderer.arena, renderer.time],
    sk: renderer.skins,
    s: app.mode === "select" || app.mode === "match" || app.mode === "room" || app.mode === "pickchar" ? { ...state, events: [] } : undefined,
    ev: events,
  });
}

const seatByGuest = (id: number) => devices.findIndex((d) => d.kind === "net" && d.id === id);

export const hostHandlers = {
  onJoin(id: number): void {
    const dev: Device = { kind: "net", id };
    // Kursi yang ditinggal tamu putus diisi dulu; di lobi, tamu pertama jadi P2 dan
    // berikutnya penonton. Host tetap bisa menukarnya.
    if (guestGone(devices[0])) devices[0] = dev;
    else if (guestGone(devices[1])) devices[1] = dev;
    else if (guestGone(spectator.device)) spectator.device = dev;
    else if (app.mode === "controls" || app.mode === "room") {
      if (app.humans === 2 && devices[1].kind !== "net") devices[1] = dev;
      else if (spectator.device.kind === "none" || spectator.device.kind === "auto") spectator.device = dev;
    }
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
  onCommand(id: number, cmd: GuestCommand): void {
    const seat = seatByGuest(id);
    // Di Room: tamu memilih jagoan untuk kursinya sendiri dari halaman Pilih Jagoan.
    if ((app.mode === "room" || app.mode === "pickchar") && seat >= 0 && seat <= 1 && cmd.c === "char") {
      if (cmd.k >= 0 && cmd.k < CHARS.length && seatKind(seat) !== "bot") {
        room.chars[seat] = cmd.k;
        room.skins[seat] = 0;
        roomPreview();
        if (app.mode === "room") renderRoom();
      }
      return;
    }
    if (app.mode !== "select" || seat < 0) return;
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
export function goJoin(code: string): void {
  setMode("join");
  if (code.length !== 4) {
    join.status = "input";
    join.text = "";
    renderJoin();
    return;
  }
  app.online = "client";
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
      // Putus di tengah jalan: coba sambung ulang beberapa kali sebelum menyerah. Host
      // mengembalikan kursimu begitu kamu masuk lagi.
      const dropped = text.startsWith("Sambungan ke host putus") && hadSeat;
      app.online = "off";
      app.seat = -1;
      mouse.capture = false;
      setNetNote("");
      setMode("join");
      startDemo();
      if (dropped && rejoinTries < 3) {
        rejoinTries++;
        join.status = "connecting";
        join.text = code;
        renderJoin();
        $("joinBox").innerHTML += `<br />Sambungan putus. Menyambung ulang (${rejoinTries}/3)…`;
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

const SEAT_NAMES = ["PEMAIN 1", "PEMAIN 2", "PENONTON USIL"];
function renderJoin(): void {
  const back = backBtn();
  if (join.status === "input" || join.status === "error") {
    $("joinBox").innerHTML =
      jpanel(
        "KETIK KODE ROOM DARI HOST",
        `<input id="roomInput" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" />`,
      ) +
      `<span class="tapbtn go" data-tap="join">GABUNG ▸</span>` +
      (join.status === "error" ? `<br /><span class="bad">${join.text}</span>` : "");
    $("joinHint").innerHTML = back;
    if (!touchState.enabled) (document.getElementById("roomInput") as HTMLInputElement | null)?.focus();
    return;
  }
  if (join.status === "connecting") {
    $("joinBox").innerHTML = jpanel(`ROOM ${join.text}`, "Menyambung ke host…");
  } else {
    const seat =
      app.seat >= 0
        ? `Kursimu: <b>${SEAT_NAMES[app.seat]}</b><br />Menunggu host memulai…`
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
}

function clientHelp(): void {
  setTouchRole(app.seat === 2 ? "spec" : app.seat >= 0 ? "player" : "off");
  const text =
    app.seat === 2
      ? touchState.enabled
        ? "<b>KAMU PENONTON USIL</b> stik geser bidikan · SMASH kulit pisang · LOMPAT sandal"
        : "<b>KAMU PENONTON USIL</b> mouse membidik · klik kiri kulit pisang · klik kanan sandal (atau C B geser, V pisang, Spasi sandal)"
      : app.seat >= 0
        ? `<b>KAMU P${app.seat + 1}</b> ${KEY_HELP[0]()}`
        : "<b>KAMU MENONTON</b>";
  elHelp.innerHTML = `${text} &nbsp;·&nbsp; <kbd>Esc</kbd> menu`;
}

function applyFrame(m: FrameMsg): void {
  if (
    Array.isArray(m.ar) &&
    ARENAS.some((a) => a.id === m.ar![0]) &&
    TIMES.some((t) => t.id === m.ar![1])
  ) {
    renderer.setArena(m.ar[0], m.ar[1]);
  }
  // Skin dari host: hanya angka 0..2, paling banyak 6 kursi.
  if (Array.isArray(m.sk)) renderer.skins = m.sk.slice(0, 6).map((x) => (x === 1 || x === 2 ? x : 0));
  const seat = Array.isArray(m.seats) ? m.seats.indexOf(net.myId) : -1;
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
  const want: Mode = m.m === "match" || m.m === "select" || m.m === "room" ? m.m : "join";
  // Jagoan di Room dari host (kursi 1 dan 2).
  let roomChanged = false;
  if (Array.isArray(m.rc) && m.rc.length >= 2) {
    for (let i = 0; i < 2; i++) {
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
    if (want === "match") {
      resetShown();
      clientHelp();
      callout(app.seat === 2 ? "KAMU PENONTON USIL!" : app.seat >= 0 ? `KAMU P${app.seat + 1}!` : "MULAI!", "#ffd23f", true);
    } else if (want === "select") renderSelect();
    else if (want === "room") {
      if (!ui.autoPicked && (app.seat === 0 || app.seat === 1)) {
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
      if (!ui.autoPicked && (app.seat === 0 || app.seat === 1)) {
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
  const spec = app.seat === 2;
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
    sendToHost(aim === null ? { t: "i", b: bits } : { t: "i", b: bits, x: aim });
  }

  if (net.ready && app.mode !== "join") {
    const stale = performance.now() - net.lastHeard > 1500;
    const note = stale ? "SAMBUNGAN TERSENDAT…" : hostPaused && app.mode === "match" ? "HOST MENJEDA" : "";
    if (elNetNote.textContent !== note) setNetNote(note);
  }

  const inMatch = app.mode === "match";
  const excite = inMatch ? excitement() : 0.12;
  crowdSfx.level(excite);
  if (inMatch) updateHud();
  renderer.draw(state, excite);
}

