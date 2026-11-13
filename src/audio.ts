// SFX disintesis dengan Web Audio, tanpa file aset.

let ctx: AudioContext | null = null;

function unlock(): void {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
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
  osc.connect(g).connect(ctx.destination);
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
    src.connect(filter).connect(gain).connect(ctx.destination);
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
    src.connect(hp).connect(g).connect(ctx.destination);
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
  osc.connect(f).connect(g).connect(ctx.destination);
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
      osc.connect(f).connect(g).connect(ctx.destination);
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
    osc.connect(g).connect(ctx.destination);
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
