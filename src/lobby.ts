// Lobi mabar online (tahap 3): layar kursi dan jagoan. Kursi, jagoan, Siap, dan aturan dipegang server;
// layar ini hanya menampilkan keadaannya dan mengirim niat pemain. Host mengatur aturan, semua orang
// memilih jagoannya sendiri secara serentak.
import { sfx } from "./audio";
import { devices, spectator } from "./input";
import { becomeHost, lobby, lobbyAct, net, roomListEnabled, setRoleHandlers, type LobbySeat } from "./net";
import { CHARS } from "./sim";
import { $, app, arenaName, backBtn, cycleOption, defaultDevices, goTitle, hex, lobbyPlan, portraits, setMode, startMatch, timeName, ui } from "./main";
import { goJoin, hostHandlers } from "./online";
import { localKey, localOn, localTap, localTick, renderLocal } from "./locallobby";

const WHY: Record<string, string> = {
  taken: "Jagoan itu sudah dipakai teman setimmu.",
  locked: "Sedang hitung mundur, tidak bisa diubah.",
  hostonly: "Hanya yang membuat room yang bisa mengubah aturan.",
  notready: "Belum semua pemain Siap.",
  noteam: "Tiap tim butuh minimal satu pemain.",
  needfull: "Bot dimatikan, jadi semua kursi harus diisi pemain.",
  offline: "Ada pemain yang sedang terputus. Tunggu atau keluarkan dia.",
  nohero: "Pilih jagoan dulu.",
  spectator: "Kamu belum dapat kursi. Pilih kursi yang kosong.",
  occupied: "Kursi itu sudah terisi.",
  early: "Tunggu hitungan selesai.",
  novote: "Belum bisa ganti host sekarang.",
  badpin: "PIN harus 4 angka.",
};

const me = (): number => lobby.pid;
const view = () => lobby.view;
export const lobbyHost = (): boolean => !!view() && view()!.host === me();
const mySeat = (): number => view()?.seats.findIndex((s) => s?.p === me()) ?? -1;
let autoHero = false; // sudah dipilihkan jagoan awal untuk kursi ini
let goSent = false;
let shownNack = "";

// Masuk ke layar lobi (host: langsung setelah room dibuat; tamu: begitu keadaan lobi pertama tiba).
export function goLobby(): void {
  autoHero = false;
  goSent = false;
  shownNack = "";
  lobby.name = lobby.name || "Pemain";
  setMode("lobby");
  if (app.online === "host") defaultDevices(null);
  lobbyPlan.on = false;
  renderLobby();
}

setRoleHandlers({
  promote() {
    // Server menjadikan kita host: sambung ulang sebagai host dengan token yang sama.
    app.online = "host";
    for (let i = 0; i < 2; i++) if (devices[i].kind === "net") devices[i] = { kind: "kbd", set: i as 0 | 1 };
    if (spectator.device.kind === "net") spectator.device = { kind: "none" };
    defaultDevices(null);
    becomeHost(hostHandlers);
    sfx.receivePerfect();
  },
  demote() {
    // Digantikan saat terputus: masuk lagi sebagai pemain biasa di room yang sama.
    const code = net.code;
    app.online = "client";
    goJoin(code);
  },
});

lobby.onChange = () => {
  if (app.online === "off") return;
  const v = view();
  if (!v) return;
  if (app.mode === "join" && app.online === "client") goLobby();
  if (app.mode !== "lobby") return;
  // Jagoan awal: yang terakhir kamu pakai kalau masih bebas di timmu, kalau tidak yang pertama bebas.
  const s = mySeat();
  if (s >= 0 && v.seats[s]!.h < 0 && v.phase === "lobby" && !autoHero) {
    autoHero = true;
    const taken = new Set(teamHeroes(s));
    const pref = [app.chars[0], ...CHARS.map((_, k) => k)].find((k) => !taken.has(k));
    if (pref !== undefined) lobbyAct({ a: "hero", k: pref });
  }
  if (s < 0 || v.seats[s]!.h >= 0) autoHero = autoHero && s >= 0;
  if (lobby.nack && lobby.nack !== shownNack) sfx.fault();
  shownNack = lobby.nack;
  renderLobby();
};

// Jagoan yang sudah dipakai teman setim di kursi `seat` (tidak termasuk diri sendiri).
function teamHeroes(seat: number): number[] {
  const v = view();
  if (!v || seat < 0) return [];
  const out: number[] = [];
  for (let k = seat & 1; k < v.fmt * 2; k += 2) {
    const o = v.seats[k];
    if (o && o.p !== me() && o.h >= 0) out.push(o.h);
  }
  return out;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function seatCard(k: number, s: LobbySeat | null): string {
  const v = view()!;
  const mine = s?.p === me();
  const team = k & 1 ? "b" : "r";
  const canMove = !s && mySeat() !== k && v.phase === "lobby";
  const tap = canMove ? ` data-tap="lb:seat:${k}"` : "";
  if (!s) {
    return (
      `<div class="lbseat ${team} empty${canMove ? " open" : ""}"${tap}>` +
      `<div class="lbpic empty">?</div><div class="lbinfo"><b class="display">${v.bots ? "BOT" : "KOSONG"}</b>` +
      `<small>${canMove ? "ketuk untuk pindah ke sini" : v.bots ? "diisi bot saat mulai" : "menunggu pemain"}</small></div></div>`
    );
  }
  const c = s.h >= 0 ? CHARS[s.h] : null;
  const tags = [s.p === v.host ? "HOST" : "", mine ? "KAMU" : ""].filter(Boolean).join(" · ");
  const kick = lobbyHost() && !mine && v.phase === "lobby" ? `<span class="lbkick" data-tap="lb:kick:${s.p}" title="Keluarkan">✕</span>` : "";
  return (
    `<div class="lbseat ${team}${mine ? " me" : ""}${s.r ? " ready" : ""}${s.o ? "" : " off"}" style="--pc:${c ? hex(c.color) : "#888"}">` +
    `<div class="lbpic">${c ? `<img src="${portraits[s.h]}" alt="" draggable="false" />` : "?"}</div>` +
    `<div class="lbinfo"><b class="display">${esc(s.n)}</b><small>${c ? c.name : "memilih jagoan…"}${tags ? ` · ${tags}` : ""}</small>` +
    `<span class="lbst">${s.o ? (s.r ? "SIAP ✓" : "belum siap") : "TERPUTUS…"}</span></div>${kick}</div>`
  );
}

export function renderLobby(): void {
  if (localOn()) return renderLocal();
  const v = view();
  if (!v) {
    $("lobbyBody").innerHTML = ui.roomError
      ? `<div class="lbwait">${esc(ui.roomError)}${ui.roomError.startsWith("Versi game") ? ` <span class="tapbtn go" data-tap="reload">PERBARUI</span>` : ""}</div>`
      : `<div class="lbwait">Menyambung ke room…</div>`;
    $("lobbyHint").innerHTML = backBtn();
    return;
  }
  const n = v.fmt * 2;
  const host = lobbyHost();
  const s = mySeat();
  $("lobbyTitle").textContent = `LOBI · ${v.fmt} LAWAN ${v.fmt}`;
  const col = (t: 0 | 1) =>
    `<div class="lbteam ${t ? "b" : "r"}"><div class="lbth display">${t ? "TIM BIRU" : "TIM MERAH"}</div>` +
    Array.from({ length: n }, (_, k) => k)
      .filter((k) => (k & 1) === t)
      .map((k) => seatCard(k, v.seats[k]))
      .join("") +
    `</div>`;
  // Grid jagoan: tiap pemain memilih untuk kursinya sendiri.
  const taken = new Set(teamHeroes(s));
  const mineH = s >= 0 ? v.seats[s]!.h : -1;
  const grid =
    s >= 0 && v.phase === "lobby"
      ? `<div class="lbgrid">` +
        CHARS.map((c, k) => {
          const off = taken.has(k);
          return (
            `<div class="lbcell${k === mineH ? " cur" : ""}${off ? " shut" : ""}" style="--pc:${hex(c.color)}"${off ? "" : ` data-tap="lb:hero:${k}"`}>` +
            `<img src="${portraits[k]}" alt="" draggable="false" /><span>${c.name}</span></div>`
          );
        }).join("") +
        `</div>`
      : `<div class="lbnote">${s < 0 ? "Kamu belum dapat kursi. Ketuk kursi kosong untuk pindah, atau tunggu ada yang keluar." : "Pertandingan akan dimulai…"}</div>`;
  const spec = v.spec.length ? `<div class="lbspec">MENONTON: ${v.spec.map((p) => esc(p.n)).join(", ")}</div>` : "";
  const chip = (label: string, value: string, tap: string) =>
    host ? `<span class="chip" data-tap="${tap}">${label}: <b>${value}</b></span>` : `<span class="chip">${label}: <b>${value}</b></span>`;
  const rules =
    chip("FORMAT", `${v.fmt} LAWAN ${v.fmt}`, "lb:fmt") +
    chip("KURSI KOSONG", v.bots ? "BOT" : "TETAP KOSONG", "lb:bots") +
    chip("CARI LAWAN CEPAT", v.quick ? "BOLEH" : "TIDAK", "lb:quick") +
    (host && roomListEnabled ? chip("ROOM", v.vis === "locked" ? `TERKUNCI · PIN ${v.pin ?? ""}` : v.vis === "open" ? "TERBUKA" : "PRIBADI", "lb:vis") : "") +
    (host ? chip("ARENA", arenaName(), "lb:arena") + chip("WAKTU", timeName(), "lb:time") + chip("MENANG DI", `${app.winScore} POIN`, "lb:win") : "");
  const code = `<div class="lbcode"><small>KODE ROOM</small><b class="display">${net.code || "····"}</b>` +
    `<span class="tapbtn go" data-tap="copylink">SALIN LINK</span></div>`;
  const left = v.phase === "count" ? Math.max(0, Math.ceil((v.until - performance.now()) / 1000)) : 0;
  const note = v.phase === "count" ? `<div class="lbcount display">MULAI DALAM ${left}…</div>` : lobby.nack ? `<div class="lbnack">${WHY[lobby.nack] ?? "Tidak bisa saat ini."}</div>` : "";
  $("lobbyBody").innerHTML =
    `<div class="lbtop">${code}<div class="lbrules">${rules}</div></div>` +
    `<div class="lbteams">${col(0)}${col(1)}</div>${spec}${note}${grid}`;
  const hostGone = !!v.seats.concat(v.spec).find((x) => x && x.p === v.host && !x.o);
  const voted = v.vote.votes.includes(me());
  const voteBtn =
    !host && v.vote.can
      ? `<span class="tapbtn${voted ? "" : " go"}" data-tap="lb:vote">${voted ? "BATAL GANTI HOST" : hostGone ? "GANTI HOST (HOST TERPUTUS)" : "GANTI HOST (HOST DIAM)"} ${v.vote.votes.length}/${v.vote.need}</span>`
      : "";
  const ready = s >= 0 && v.seats[s]!.r;
  const canReady = s >= 0 && mineH >= 0 && v.phase !== "play";
  $("lobbyHint").innerHTML =
    backBtn() +
    `<span class="tapbtn${ready ? "" : " go"}${canReady ? "" : " off"}" data-tap="lb:ready">${ready ? "BATAL SIAP" : "SIAP ▸"} <kbd>Enter</kbd></span>` +
    (host ? `<span class="tapbtn go${v.phase === "lobby" ? "" : " off"}" data-tap="lb:start">MULAI ▸</span>` : `<span class="tapbtn off">${v.phase === "count" ? "MULAI…" : "MENUNGGU HOST"}</span>`) +
    voteBtn;
}

// Dipanggil tiap frame dari loop: hitung mundur tampil dan host mengirim "go" lalu memulai pertandingan.
export function lobbyTick(now: number): void {
  if (localOn()) return localTick(now);
  const v = view();
  if (!v || app.mode !== "lobby") return;
  if (v.phase !== "count") {
    goSent = false;
    return;
  }
  if (now - lastDraw > 250) {
    lastDraw = now;
    renderLobby();
  }
  if (lobbyHost() && !goSent && now >= v.until) {
    goSent = true;
    lobbyAct({ a: "go" });
    startLobbyMatch();
  }
}
let lastDraw = 0;

// Host: susun pertandingan dari tabel kursi di server. Kursi tanpa pemain diisi bot dengan jagoan yang belum dipakai.
function startLobbyMatch(): void {
  const v = view();
  if (!v) return;
  const n = v.fmt * 2;
  const pids = Array.from({ length: n }, (_, k) => v.seats[k]?.p ?? -1);
  const chars = pids.map((p, k) => (p >= 0 ? v.seats[k]!.h : -1));
  const used = new Set(chars.filter((c) => c >= 0));
  const free = CHARS.map((_, k) => k).filter((k) => !used.has(k));
  const skins = chars.map(() => 0);
  for (let k = 0; k < n; k++) {
    if (chars[k] < 0) {
      chars[k] = free.splice(Math.floor(Math.random() * free.length), 1)[0] ?? k % CHARS.length;
      skins[k] = Math.floor(Math.random() * 3);
    }
  }
  Object.assign(lobbyPlan, { on: true, pids, host: v.host, chars, skins });
  app.teamSize = v.fmt;
  app.humans = 1;
  app.mate = false;
  app.training = false;
  app.arcade.on = false;
  if (spectator.device.kind === "net") spectator.device = { kind: "none" };
  startMatch();
}

// Host: setelah pertandingan, kembali ke lobi (siap dihapus, jagoan tetap).
export function lobbyReturn(): void {
  lobbyPlan.on = false;
  lobbyAct({ a: "end" });
  goLobby();
}

export function lobbyTap(v: string): void {
  if (localOn()) return localTap(v);
  const [, a, arg] = v.split(":");
  const s = view();
  if (!s) return;
  if (a === "hero") lobbyAct({ a: "hero", k: Number(arg) });
  else if (a === "ready") {
    const mine = mySeat();
    if (mine < 0) return;
    lobbyAct({ a: "ready", v: !s.seats[mine]!.r });
  } else if (a === "seat") lobbyAct({ a: "seat", s: Number(arg) });
  else if (a === "kick") lobbyAct({ a: "kick", p: Number(arg) });
  else if (a === "start") lobbyAct({ a: "start" });
  else if (a === "fmt") lobbyAct({ a: "rules", fmt: (s.fmt % 3) + 1 });
  else if (a === "bots") lobbyAct({ a: "rules", bots: !s.bots });
  else if (a === "quick") lobbyAct({ a: "rules", quick: !s.quick });
  else if (a === "vis") lobbyAct({ a: "rules", vis: s.vis === "private" ? "open" : s.vis === "open" ? "locked" : "private" });
  else if (a === "vote") lobbyAct({ a: "vote" });
  else if (a === "arena" || a === "time" || a === "win") cycleOption(a);
  lobby.nack = "";
  sfx.swing();
}

export function lobbyKey(code: string): void {
  if (localOn()) return localKey(code);
  const v = view();
  if (code === "Escape" || code === "Backspace") return goTitle();
  if (!v) return;
  const s = mySeat();
  if (code === "Enter" || code === "NumpadEnter") {
    if (s < 0) return;
    const mine = v.seats[s]!;
    // Host: Enter pertama Siap, Enter berikutnya (kalau sudah siap) memulai.
    if (lobbyHost() && mine.r && v.phase === "lobby") lobbyAct({ a: "start" });
    else lobbyAct({ a: "ready", v: !mine.r });
    return;
  }
  if ((code === "ArrowLeft" || code === "KeyA" || code === "ArrowRight" || code === "KeyD") && s >= 0 && v.phase === "lobby") {
    const dir = code === "ArrowLeft" || code === "KeyA" ? -1 : 1;
    const taken = new Set(teamHeroes(s));
    let k = v.seats[s]!.h < 0 ? 0 : v.seats[s]!.h;
    for (let i = 0; i < CHARS.length; i++) {
      k = (k + dir + CHARS.length) % CHARS.length;
      if (!taken.has(k)) break;
    }
    lobbyAct({ a: "hero", k });
  }
}
