// Suara game. Dua lapis: file suara dari public/audio/ (dibuat dengan ElevenLabs lewat
// `npm run audio`), dan SFX yang disintesis dengan Web Audio sebagai cadangan. Kalau sebuah
// file belum ada atau gagal dimuat, versi sintetisnya yang berbunyi.

let ctx: AudioContext | null = null;

// ----- Volume -----
// Semua suara lewat satu keran utama; efek, suara orang, dan musik punya keran sendiri.
type BusName = "sfx" | "voice" | "music";
const BUS_GAIN: Record<BusName, number> = { sfx: 1, voice: 1, music: 0.32 };
const buses: Partial<Record<BusName, GainNode>> = {};
let master: GainNode | null = null;

const VOLUME_KEY = "takraw.volume";
export const VOLUME_STEPS = [1, 0.5, 0];
let volume = 1;
try {
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw !== null && VOLUME_STEPS.includes(Number(raw))) volume = Number(raw);
} catch {
  // penyimpanan diblokir: pakai volume penuh
}

export const getVolume = () => volume;
export function setVolume(v: number): void {
  volume = v;
  if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    // tidak apa-apa
  }
}

// Hanya dipanggil saat ctx sudah ada.
function bus(name: BusName): GainNode {
  const c = ctx!;
  if (!master) {
    master = c.createGain();
    master.gain.value = volume;
    master.connect(c.destination);
  }
  let node = buses[name];
  if (!node) {
    node = c.createGain();
    node.gain.value = BUS_GAIN[name];
    node.connect(master);
    buses[name] = node;
  }
  return node;
}

// ----- File suara -----
const BASE = `${import.meta.env.BASE_URL}audio/`;
const buffers = new Map<string, AudioBuffer>();
const known = new Map<string, string>(); // id -> jenis
const boost = new Map<string, number>(); // id -> pengali supaya semua file sama kerasnya
const PEAK_TARGET = 0.8;
const PEAK_SILENT = 0.02; // di bawah ini filenya dianggap kosong dan tidak dipakai
let indexLoaded = false;

async function loadBuffer(id: string): Promise<AudioBuffer | null> {
  if (!ctx) return null;
  const have = buffers.get(id);
  if (have) return have;
  try {
    const res = await fetch(`${BASE}${id}.mp3`);
    if (!res.ok) return null;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    // Hasil pembuatan suara tidak sama kerasnya, dan kadang nyaris kosong. Ukur puncaknya:
    // yang kosong dibuang (versi sintetis yang berbunyi), sisanya disamakan kerasnya.
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const v = d[i] < 0 ? -d[i] : d[i];
        if (v > peak) peak = v;
      }
    }
    if (peak < PEAK_SILENT) return null;
    boost.set(id, Math.min(8, PEAK_TARGET / peak));
    buffers.set(id, buf);
    return buf;
  } catch {
    return null;
  }
}

async function loadIndex(): Promise<void> {
  if (indexLoaded) return;
  indexLoaded = true;
  try {
    const res = await fetch(`${BASE}index.json`);
    if (!res.ok) return;
    const items = (await res.json()) as Array<{ id: string; type: string }>;
    for (const it of items) known.set(it.id, it.type);
    // Efek dan suara orang dimuat di awal supaya langsung siap; musik dimuat saat diminta.
    for (const it of items) if (it.type !== "music") void loadBuffer(it.id);
    // Musik sintetis yang sudah berjalan diganti filenya kalau ternyata ada.
    if (wantTrack && current && known.has(current.track)) {
      current.stop();
      current = null;
    }
    if (wantTrack) music(wantTrack);
  } catch {
    // tanpa file suara: semua memakai versi sintetis
  }
}

// Memutar file suara. Mengembalikan false kalau belum tersedia, supaya pemanggil
// bisa memakai versi sintetis.
function sample(id: string, gain = 1, to: BusName = "sfx"): boolean {
  const buf = buffers.get(id);
  if (!ctx || ctx.state !== "running" || !buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain * (boost.get(id) ?? 1);
  src.connect(g).connect(bus(to));
  src.start();
  return true;
}

// Suara komentator; diam saja kalau filenya belum ada.
export function voice(id: string): void {
  sample(id, 1, "voice");
}

// ----- Musik -----
// Kalau ada file musiknya (public/audio/music_*.mp3), file itu yang diputar. Kalau tidak,
// musiknya dimainkan langsung oleh penyusun nada kecil di bawah: kendang, bas, dan melodi
// bernada pentatonik, tanpa file sama sekali.
export type Track = "music_menu" | "music_match" | "music_tense";
let wantTrack: Track | null = null;
let current: { track: Track; stop: () => void } | null = null;

interface Song {
  bpm: number;
  root: number; // frekuensi nada dasar
  scale: number[]; // tangga nada, dalam setengah nada dari nada dasar
  lead: string[]; // per birama 16 langkah: angka = urutan nada di tangga nada, titik = diam
  bass: number[]; // nada bas per birama, dalam setengah nada
  bassHits: number[]; // langkah tempat bas berbunyi
  drums: string[]; // per birama: k = dung, t = tak, s = kecrek
  leadWave: OscillatorType;
}

const SLENDRO = [0, 2, 4, 7, 9];
const PELOG = [0, 1, 3, 7, 8];
const SONGS: Record<Track, Song> = {
  music_menu: {
    bpm: 108,
    root: 261.63,
    scale: SLENDRO,
    lead: ["0.2.4.2.5.4.2.0.", "2.4.5.4.7...5.4.", "5.7.5.4.2.4.5.2.", "4.2.0.2.0......."],
    bass: [0, -3, 5, 7],
    bassHits: [0, 6, 8, 14],
    drums: ["k.s.t.s.k.sst.s.", "k.s.t.s.k.sst.tt"],
    leadWave: "triangle",
  },
  music_match: {
    bpm: 138,
    root: 293.66,
    scale: PELOG,
    lead: ["5.5.4.3.4...3.2.", "3.4.5.7.5...4.3.", "5.5.7.8.7.5.4.3.", "2.3.2.0.0......."],
    bass: [0, 0, -4, -5],
    bassHits: [0, 3, 6, 8, 11, 14],
    drums: ["k.stk.stk.stktst", "k.stk.stk.sttktt"],
    leadWave: "square",
  },
  music_tense: {
    bpm: 152,
    root: 220,
    scale: PELOG,
    lead: ["0...0...1...0...", "3...3...4...3.2.", "0...0...1...0...", "5...4...3.2.1.0."],
    bass: [0, 0, 1, 0],
    bassHits: [0, 2, 4, 6, 8, 10, 12, 14],
    drums: ["ktstktstktstktst", "ktstktstkttkkttt"],
    leadWave: "sawtooth",
  },
};

function note(song: Song, degree: number): number {
  const n = song.scale.length;
  return song.root * 2 ** ((song.scale[degree % n] + 12 * Math.floor(degree / n)) / 12);
}

// Satu nada pendek dengan selubung pukul-lalu-luruh.
function pluck(out: AudioNode, type: OscillatorType, from: number, to: number, t: number, dur: number, gain: number): void {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function hiss(out: AudioNode, t: number, dur: number, gain: number, cutoff: number): void {
  const c = ctx!;
  const buf = noise();
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

function playStep(song: Song, out: AudioNode, step: number, t: number): void {
  const bar = Math.floor(step / 16);
  const at = step % 16;
  const drum = song.drums[bar % song.drums.length][at];
  if (drum === "k") pluck(out, "sine", 130, 48, t, 0.16, 0.9);
  else if (drum === "t") {
    pluck(out, "triangle", 430, 300, t, 0.06, 0.35);
    hiss(out, t, 0.04, 0.18, 2500);
  } else if (drum === "s") hiss(out, t, 0.03, 0.1, 6000);

  const songBar = bar % song.lead.length;
  if (song.bassHits.includes(at)) {
    const f = (song.root / 4) * 2 ** (song.bass[songBar % song.bass.length] / 12);
    pluck(out, "triangle", f, f, t, 0.2, 0.55);
  }
  const ch = song.lead[songBar][at];
  if (ch !== ".") {
    const f = note(song, Number(ch));
    pluck(out, song.leadWave, f, f, t, 0.22, song.leadWave === "triangle" ? 0.32 : 0.14);
    // Gema tipis satu oktaf di atas, seperti angklung.
    pluck(out, "sine", f * 2, f * 2, t + 0.01, 0.12, 0.08);
  }
}

function startSynth(track: Track): () => void {
  const c = ctx!;
  const song = SONGS[track];
  const out = c.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1.6, c.currentTime, 0.3);
  out.connect(bus("music"));
  const stepDur = 60 / song.bpm / 4;
  let step = 0;
  let next = c.currentTime + 0.08;
  // Nada dijadwalkan sedikit di depan waktu supaya temponya tetap rapi.
  const timer = window.setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05; // tab sempat tertidur: lanjut dari sekarang
    while (next < ctx.currentTime + 0.2) {
      playStep(song, out, step, next);
      step++;
      next += stepDur;
    }
  }, 40);
  return () => {
    window.clearInterval(timer);
    out.gain.setTargetAtTime(0, c.currentTime, 0.2);
    window.setTimeout(() => out.disconnect(), 1500);
  };
}

function startFile(track: Track, buf: AudioBuffer): () => void {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(boost.get(track) ?? 1, c.currentTime, 0.4);
  src.connect(gain).connect(bus("music"));
  src.start();
  return () => {
    gain.gain.setTargetAtTime(0, c.currentTime, 0.25);
    src.stop(c.currentTime + 1.2);
  };
}

export function music(track: Track | null): void {
  wantTrack = track;
  if (!ctx || ctx.state !== "running") return;
  if (current && current.track === track) return;
  current?.stop();
  current = null;
  if (!track) return;
  if (!known.has(track)) {
    current = { track, stop: startSynth(track) };
    return;
  }
  void loadBuffer(track).then((buf) => {
    // Bisa saja sudah diganti lagu lain selagi memuat.
    if (!ctx || wantTrack !== track || current) return;
    current = { track, stop: buf ? startFile(track, buf) : startSynth(track) };
  });
}

function unlock(): void {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().then(() => wantTrack && music(wantTrack));
  void loadIndex();
}
window.addEventListener("keydown", unlock);
window.addEventListener("pointerdown", unlock);
window.addEventListener("gamepadconnected", unlock);

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  gain: number,
  delay = 0,
): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(bus("sfx"));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Penonton: derau yang disaring jadi gumam, dengan sorakan dan tepuk tangan.
let crowd: { gain: GainNode; filter: BiquadFilterNode; base: number } | null = null;
let noiseBuf: AudioBuffer | null = null;

function noise(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function ensureCrowd(): typeof crowd {
  if (!ctx || ctx.state !== "running") return null;
  if (!crowd) {
    const buf = noise();
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(bus("sfx"));
    src.start();
    crowd = { gain, filter, base: 0.02 };
  }
  return crowd;
}

export const crowdSfx = {
  // Tingkat gumam mengikuti ketegangan (0..1).
  level(x: number): void {
    const c = ensureCrowd();
    if (!c || !ctx) return;
    c.base = 0.018 + x * 0.07;
    c.gain.gain.setTargetAtTime(c.base, ctx.currentTime, 0.5);
  },
  cheer(strength = 1): void {
    const c = ensureCrowd();
    if (!c || !ctx) return;
    const t = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setValueAtTime(c.gain.gain.value, t);
    c.gain.gain.linearRampToValueAtTime(0.1 + 0.12 * strength, t + 0.15);
    c.gain.gain.setTargetAtTime(c.base, t + 0.5 + 0.7 * strength, 0.6);
    c.filter.frequency.cancelScheduledValues(t);
    c.filter.frequency.setValueAtTime(c.filter.frequency.value, t);
    c.filter.frequency.linearRampToValueAtTime(1500 + 500 * strength, t + 0.2);
    c.filter.frequency.setTargetAtTime(800, t + 0.9, 0.6);
  },
  // "Ooh": nada turun saat ada yang kewalahan.
  gasp(): void {
    const c = ensureCrowd();
    if (!c || !ctx) return;
    const t = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setValueAtTime(c.gain.gain.value, t);
    c.gain.gain.linearRampToValueAtTime(0.11, t + 0.08);
    c.gain.gain.setTargetAtTime(c.base, t + 0.35, 0.3);
    c.filter.frequency.cancelScheduledValues(t);
    c.filter.frequency.setValueAtTime(1100, t);
    c.filter.frequency.exponentialRampToValueAtTime(450, t + 0.5);
    c.filter.frequency.setTargetAtTime(800, t + 0.7, 0.4);
  },
  clap(): void {
    const buf = noise();
    if (!ctx || ctx.state !== "running" || !buf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 1900;
    hp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp).connect(g).connect(bus("sfx"));
    src.start(t, Math.random());
    src.stop(t + 0.09);
  },
};

// ===== Suara konyol =====
// Satu suku "ha": gelombang gergaji lewat saringan forman supaya mirip suara mulut.
function ha(freq: number, at: number, dur: number, gain: number, formant: number): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq * 1.12, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.9, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = formant;
  f.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f).connect(g).connect(bus("sfx"));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sillySfx = {
  // Penonton tertawa: beberapa suara dengan nada berbeda, masing-masing "ha-ha-ha" menurun.
  laugh(): void {
    const voices = [
      { pitch: 290, start: 0, step: 0.125, formant: 950 },
      { pitch: 370, start: 0.05, step: 0.115, formant: 1150 },
      { pitch: 215, start: 0.09, step: 0.14, formant: 800 },
      { pitch: 440, start: 0.16, step: 0.105, formant: 1300 },
    ];
    for (const v of voices) {
      for (let k = 0; k < 8; k++) {
        ha(v.pitch * Math.pow(0.955, k), v.start + k * v.step, 0.09, 0.11 * (1 - k * 0.07), v.formant);
      }
    }
  },
  // Trombon sedih: "wah, wah, wah, waaah".
  trombone(): void {
    if (!ctx || ctx.state !== "running") return;
    const notes: Array<[number, number, number]> = [
      [311, 0, 0.3],
      [294, 0.32, 0.3],
      [277, 0.64, 0.3],
      [262, 0.96, 0.85],
    ];
    for (const [freq, at, dur] of notes) {
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq * (dur > 0.5 ? 0.86 : 0.97), t + dur);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = 5;
      f.frequency.setValueAtTime(400, t);
      f.frequency.linearRampToValueAtTime(1500, t + dur * 0.3);
      f.frequency.linearRampToValueAtTime(350, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.04);
      g.gain.setValueAtTime(0.16, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(f).connect(g).connect(bus("sfx"));
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  },
  // "Boing" pegas: nada turun dengan getaran cepat.
  boing(): void {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(70, t);
    depth.gain.exponentialRampToValueAtTime(4, t + 0.4);
    lfo.connect(depth).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(g).connect(bus("sfx"));
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.45);
    lfo.stop(t + 0.45);
  },
  // Peluit meluncur turun.
  slide: () => tone("sine", 1500, 260, 0.5, 0.12),
};

export const sfx = {
  touch: () => tone("triangle", 520, 300, 0.09, 0.25),
  // Nada smash naik mengikuti panas reli (0..1).
  smash: (heat = 0) => {
    tone("square", 220 * (1 + heat * 0.9), 60, 0.18, 0.22);
    tone("sawtooth", 900 * (1 + heat * 0.6), 120, 0.1, 0.12);
  },
  perfect: () => {
    tone("square", 330, 70, 0.22, 0.24);
    tone("triangle", 1319, 1319, 0.09, 0.2);
    tone("triangle", 1976, 1976, 0.16, 0.2, 0.07);
  },
  receive: () => tone("sine", 240, 420, 0.12, 0.2),
  receivePerfect: () => {
    tone("sine", 300, 600, 0.1, 0.2);
    tone("triangle", 1568, 1568, 0.14, 0.18, 0.05);
  },
  weak: () => tone("sawtooth", 180, 70, 0.16, 0.18),
  bounce: () => tone("sine", 260, 180, 0.06, 0.12),
  jump: () => tone("sine", 300, 620, 0.1, 0.1),
  dash: () => tone("sawtooth", 500, 140, 0.09, 0.06),
  swing: () => tone("sine", 700, 350, 0.06, 0.04),
  special: () => tone("sawtooth", 180, 720, 0.18, 0.12),
  fire: () => {
    tone("square", 160, 40, 0.35, 0.28);
    tone("sawtooth", 1400, 90, 0.25, 0.16);
  },
  curve: () => tone("sine", 400, 1300, 0.3, 0.2),
  curveDrop: () => tone("sine", 1300, 200, 0.22, 0.2),
  score: () => {
    tone("triangle", 523, 523, 0.12, 0.2);
    tone("triangle", 784, 784, 0.2, 0.2, 0.12);
  },
  fault: () => tone("square", 200, 90, 0.3, 0.15),
  over: () => {
    tone("triangle", 523, 523, 0.14, 0.2);
    tone("triangle", 659, 659, 0.14, 0.2, 0.14);
    tone("triangle", 784, 784, 0.14, 0.2, 0.28);
    tone("triangle", 1047, 1047, 0.35, 0.2, 0.42);
  },
};

// Kalau file suaranya tersedia, itu yang diputar; kalau tidak, versi sintetis di atas.
function preferSamples(obj: Record<string, (...args: never[]) => void>, map: Record<string, [string, number]>): void {
  for (const [key, [id, gain]] of Object.entries(map)) {
    const synth = obj[key] as (...args: unknown[]) => void;
    obj[key] = ((...args: unknown[]) => {
      if (!sample(id, gain)) synth(...args);
    }) as (...args: never[]) => void;
  }
}
preferSamples(sfx, {
  touch: ["touch", 0.8],
  smash: ["smash", 1],
  perfect: ["perfect", 1],
  receive: ["receive", 0.8],
  receivePerfect: ["receive_perfect", 0.9],
  weak: ["weak", 0.8],
  special: ["special", 0.9],
  fire: ["fire", 0.9],
  score: ["score", 0.8],
  fault: ["fault", 0.7],
  over: ["over", 0.9],
});
preferSamples(sillySfx, {
  laugh: ["laugh", 0.8],
  trombone: ["trombone", 0.8],
  boing: ["bonk", 0.9],
  slide: ["slip", 0.9],
});
preferSamples(crowdSfx, { cheer: ["cheer", 0.7], gasp: ["gasp", 0.7] });
