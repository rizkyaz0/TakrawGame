// Halaman menu: pengaturan, tombol keyboard, cara main, dan profil (akun).
import { sfx, voice } from "./audio";
import { saveSettings, settings } from "./settings";
import { account, authEnabled, renameProfile, signInGoogle, signOut } from "./auth";
import { ACHIEVEMENTS, progress, isUnlocked } from "./progress";
import { devices, type Device, KEY_ACTIONS, resetKeys, setKey, keyLabel, keyFor } from "./input";
import { touchCapable } from "./touch";
import { CHARS } from "./sim";
import { $, CONFIRM, DOWN, LEFT, RIGHT, UP, app, applySettings, backBtn, portraits, renderer, setMode, slotOf, tapBtn, ARCADE_LEVELS, hex, PAD_HELP, KEY_HELP, SPECIAL_DESC } from "./main";

// Getaran: HP lewat navigator.vibrate, stick lewat motor getarnya.
export function buzz(player: number, ms: number): void {
  if (!settings.vibrate) return;
  if (app.online === "client") {
    if (app.seat === player) navigator.vibrate?.(ms);
    return;
  }
  if (app.mode !== "match") return;
  if (player !== 0 && !(app.humans === 2 && player === slotOf(1))) return;
  const d: Device = devices[player === 0 ? 0 : 1];
  if (d.kind === "touch") navigator.vibrate?.(ms);
  else if (d.kind === "pad") {
    type Rumble = { playEffect?: (kind: string, opts: Record<string, number>) => Promise<unknown> };
    const pad = navigator.getGamepads?.()[d.index] as (Gamepad & { vibrationActuator?: Rumble }) | null | undefined;
    void pad?.vibrationActuator
      ?.playEffect?.("dual-rumble", { duration: ms * 3, strongMagnitude: 0.6, weakMagnitude: 0.4 })
      ?.catch(() => undefined);
  }
}

interface SettingRow {
  label: string;
  note?: string;
  value(): string;
  step(dir: number): void;
}
export const pct = (v: number) => (v === 0 ? "MATI" : `${Math.round(v * 100)}%`);
const stepLevel = (v: number, dir: number) => Math.min(1, Math.max(0, Math.round((v + dir * 0.25) * 4) / 4));
export function settingRows(): SettingRow[] {
  const rows: SettingRow[] = [
    { label: "Musik", value: () => pct(settings.music), step: (d) => (settings.music = stepLevel(settings.music, d)) },
    { label: "Efek suara", value: () => pct(settings.sfx), step: (d) => (settings.sfx = stepLevel(settings.sfx, d)) },
    { label: "Komentator", value: () => pct(settings.voice), step: (d) => (settings.voice = stepLevel(settings.voice, d)) },
    {
      label: "Getaran",
      note: "HP dan stick yang mendukung",
      value: () => (settings.vibrate ? "NYALA" : "MATI"),
      step: () => (settings.vibrate = !settings.vibrate),
    },
  ];
  if (touchCapable()) {
    rows.push({
      label: "Ukuran tombol layar",
      value: () => ["KECIL", "SEDANG", "BESAR"][settings.touchSize],
      step: (d) => (settings.touchSize = (settings.touchSize + d + 3) % 3),
    });
  }
  rows.push(
    {
      label: "Efek layar",
      note: "Guncangan dan kilatan",
      value: () => (settings.calm ? "DIKURANGI" : "PENUH"),
      step: () => (settings.calm = !settings.calm),
    },
    {
      label: "Tombol keyboard",
      note: "Ubah tombol untuk P1 (WASD) dan P2 (panah)",
      value: () => "UBAH ▸",
      step: () => undefined,
    },
    {
      label: "Teks menu",
      note: "Perbesar tulisan dan tombol menu",
      value: () => (settings.bigText ? "BESAR" : "NORMAL"),
      step: () => (settings.bigText = !settings.bigText),
    },
    {
      label: "Gaya",
      note: "Kartun 3D halus, atau gambar tangan berarsir",
      value: () => (settings.style === "soft" ? "KARTUN 3D" : "GAMBAR TANGAN"),
      step: () => (settings.style = settings.style === "soft" ? "hand" : "soft"),
    },
    {
      label: "Grafis",
      note: "Hemat: lebih lancar di HP yang berat",
      value: () => (settings.lowGfx ? "HEMAT" : "TINGGI"),
      step: () => (settings.lowGfx = !settings.lowGfx),
    },
  );
  return rows;
}

export function stepSetting(row: number, dir: number): void {
  const r = settingRows()[row];
  if (!r) return;
  if (r.label === "Tombol keyboard") return goKeys();
  r.step(dir);
  applySettings();
  saveSettings();
  if (r.label === "Gaya") CHARS.forEach((_, k) => (portraits[k] = renderer.portrait(k)));
  if (r.label === "Komentator") voice("vo_mulai");
  else if (r.label === "Getaran" && settings.vibrate) navigator.vibrate?.(40);
  else sfx.smash(0);
  renderSettings();
}

export function renderSettings(): void {
  const box = $("setRows");
  const keep = box.scrollTop;
  box.innerHTML = settingRows()
    .map(
      (r, i) =>
        `<div class="srow${app.setRow === i ? " on" : ""}" data-tap="setrow:${i}">` +
        `<div class="slabel display">${r.label}${r.note ? `<small>${r.note}</small>` : ""}</div>` +
        `<span class="carr" data-tap="set:${i}:-1">◂</span><span class="sval display">${r.value()}</span>` +
        `<span class="carr" data-tap="set:${i}:1">▸</span></div>`,
    )
    .join("");
  // Daftar yang panjang bisa digulir; gulirannya dijaga, dan baris terpilih selalu terlihat.
  box.scrollTop = keep;
  const on = box.querySelector<HTMLElement>(".srow.on");
  if (on) {
    if (on.offsetTop < box.scrollTop) box.scrollTop = on.offsetTop - 4;
    else if (on.offsetTop + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = on.offsetTop + on.offsetHeight - box.clientHeight + 8;
  }
  $("setHint").innerHTML = backBtn();
}

// ===== Ubah tombol keyboard =====
export const keysUi = { set: 0 as 0 | 1, row: 0, waiting: false };
const RESERVED_KEYS = new Set(["Escape", "Enter", "NumpadEnter", "Backspace", "Tab", "MetaLeft", "MetaRight", "ContextMenu"]);

function goKeys(): void {
  setMode("keys");
  keysUi.waiting = false;
  renderKeys();
}

export function renderKeys(): void {
  const col = (set: 0 | 1) =>
    `<div class="kcol"><h3>${set === 0 ? "PEMAIN 1 · WASD" : "PEMAIN 2 · PANAH"}</h3>` +
    KEY_ACTIONS.map((a, r) => {
      const on = keysUi.set === set && keysUi.row === r;
      const wait = on && keysUi.waiting;
      return (
        `<div class="krow${on ? " on" : ""}" data-tap="kk:${set}:${r}"><span>${a.label}</span>` +
        `<b class="display">${wait ? "TEKAN TOMBOL…" : keyLabel(keyFor(set, a.id))}</b></div>`
      );
    }).join("") +
    `</div>`;
  $("keysBody").innerHTML = col(0) + col(1);
  $("keysNote").innerHTML = keysUi.waiting
    ? `Tekan tombol baru. <kbd>Esc</kbd> batal. Kalau tombolnya sudah dipakai aksi lain, keduanya bertukar.`
    : `<kbd>W</kbd><kbd>S</kbd> pilih · <kbd>A</kbd><kbd>D</kbd> pindah pemain · <kbd>Enter</kbd> ubah · <kbd>R</kbd> kembalikan bawaan`;
  $("keysHint").innerHTML = backBtn() + tapBtn("go", "KeyR", "KEMBALIKAN BAWAAN", "R");
}

export function keysKey(code: string): void {
  if (keysUi.waiting) {
    if (code !== "Escape" && !RESERVED_KEYS.has(code)) {
      setKey(keysUi.set, KEY_ACTIONS[keysUi.row].id, code);
      sfx.receivePerfect();
    } else if (code !== "Escape") sfx.fault();
    keysUi.waiting = false;
    renderKeys();
    return;
  }
  const n = KEY_ACTIONS.length;
  if (code === "Escape" || code === "Backspace") goSettings();
  else if (UP.has(code)) (keysUi.row = (keysUi.row + n - 1) % n), sfx.swing(), renderKeys();
  else if (DOWN.has(code)) (keysUi.row = (keysUi.row + 1) % n), sfx.swing(), renderKeys();
  else if (LEFT.has(code) || RIGHT.has(code)) (keysUi.set = keysUi.set === 0 ? 1 : 0), sfx.swing(), renderKeys();
  else if (code === "KeyR") {
    resetKeys();
    sfx.swing();
    renderKeys();
  } else if (CONFIRM.has(code)) {
    keysUi.waiting = true;
    sfx.swing();
    renderKeys();
  }
}

export function goHowto(): void {
  setMode("howto");
  const keys = (set: 0 | 1) => `<p><b>${set === 0 ? "Keyboard WASD" : "Keyboard panah"}</b><br />${KEY_HELP[set]()}</p>`;
  const jurus = CHARS.map(
    (c) => `<b style="--pc:${hex(c.color)}">${c.name}</b><span><i>${c.specialName}</i> · ${SPECIAL_DESC[c.special]}</span>`,
  ).join("");
  $("howBody").innerHTML =
    `<div class="hcol"><h3>KONTROL</h3>${keys(0)}${keys(1)}<p><b>Stick</b><br />${PAD_HELP}</p>` +
    `<p><b>HP</b><br />Stik di kiri layar untuk gerak, tombol aksi di kanan layar.</p>` +
    `<h3>ATURAN SINGKAT</h3>` +
    `<p>Satu tim boleh menyentuh bola maksimal <b>3 kali</b>. Bola jatuh di lantai lawan = poin. Menang di ${app.winScore} poin dengan selisih 2.</p>` +
    `<p><b>Smash</b>: tekan saat bola dekat badan. <b>Tahan</b> tombolnya saat kena: kamu melayang sebentar, arahkan bola, lepas untuk menembak. Tekan tepat saat cincin emas = <b>sempurna</b>.</p>` +
    `<p><b>Terima</b>: tekan sedikit sebelum bola sampai untuk menjinakkan bola kencang atau bola jurus.</p>` +
    `<p>Meter terisi dari sentuhan, smash, dan terima. Penuh = <b>jurus</b>.</p></div>` +
    `<div class="hcol"><h3>JURUS TIAP JAGOAN</h3><div class="jur">${jurus}</div></div>`;
  $("howHint").innerHTML = backBtn();
}

export function profileAccountAction(): void {
  if (!authEnabled) return;
  if (account.user) void signOut();
  else void signInGoogle();
}

export function profileRename(): void {
  if (!account.user || !account.profile) return;
  const n = window.prompt("Nama baru (3–16 karakter: huruf, angka, spasi, _):", account.profile.displayName);
  if (n === null) return;
  void renameProfile(n).then((err) => {
    if (err) window.alert(err);
  });
}

function accountBox(): string {
  if (!authEnabled) return "";
  if (account.user && account.profile) {
    const st = account.syncing ? "menyinkronkan…" : account.error ? "gagal sinkron" : "tersimpan di akun";
    return `<div class="pfav">Masuk sebagai <b>${escapeHtml(account.profile.displayName)}</b> · ${st}</div>`;
  }
  return `<div class="pfav">Main sebagai <b>tamu</b>: progres hanya di perangkat ini. Masuk dengan Google untuk menyimpannya di akun.</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function goProfile(): void {
  setMode("profile");
  renderProfile();
}

export function renderProfile(): void {
  const p = progress;
  const stat = (label: string, value: string | number) => `<div class="pstat"><b class="display">${value}</b>${label}</div>`;
  const rate = p.matches > 0 ? `${Math.round((p.wins / p.matches) * 100)}%` : "–";
  const fav = Object.entries(p.winsByChar).sort((a, b) => b[1] - a[1])[0];
  $("profBox").innerHTML =
    accountBox() +
    `<div class="pstats">` +
    stat("pertandingan", p.matches) +
    stat("menang", p.wins) +
    stat("tingkat menang", rate) +
    stat("smash sempurna", p.perfectSmash) +
    stat("terima sempurna", p.perfectReceive) +
    stat("jurus kena", p.specials) +
    stat("reli terpanjang", p.bestRally) +
    stat("babak arcade terjauh", `${p.arcadeBest}/${ARCADE_LEVELS.length}`) +
    `</div>` +
    `<div class="pfav">Jagoan andalan: <b>${fav ? `${fav[0]} (${fav[1]} menang)` : "belum ada"}</b> · ` +
    `Jagoan terbuka: <b>${CHARS.filter((_, k) => isUnlocked(k)).length}/${CHARS.length}</b> · ` +
    `Pencapaian: <b>${p.achievements.length}/${ACHIEVEMENTS.length}</b></div>` +
    `<div class="pach">` +
    ACHIEVEMENTS.map((a) => {
      const got = p.achievements.includes(a.id);
      const c = a.count?.(p);
      const prog = !got && c ? ` <i>${Math.min(c[0], c[1])}/${c[1]}</i>` : "";
      return `<div class="ach${got ? " got" : ""}"><b>${got ? "★" : "☆"} ${a.name}</b>${a.desc}${prog}</div>`;
    }).join("") +
    `</div>`;
  $("profHint").innerHTML =
    backBtn() +
    (authEnabled
      ? account.user
        ? tapBtn("", "rename", "GANTI NAMA", "N") + tapBtn("", "login", "KELUAR AKUN", "G")
        : tapBtn("go", "login", "MASUK DENGAN GOOGLE", "G")
      : "");
}

export function goSettings(): void {
  setMode("settings");
  app.setRow = 0;
  renderSettings();
}


