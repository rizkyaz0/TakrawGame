// Pengaturan pemain, disimpan di perangkat ini.

export const settings = {
  music: 1, // 0..1
  sfx: 1,
  voice: 1,
  vibrate: true,
  touchSize: 1, // 0 kecil, 1 sedang, 2 besar
  calm: false, // kurangi guncangan dan kilatan layar
  lowGfx: false, // grafis hemat untuk HP yang berat
  style: "soft" as "soft" | "hand", // soft = kartun 3D halus mengilap, hand = gambar tangan berarsir
  tutorialDone: false,
};

export type Settings = typeof settings;

const KEY = "takraw.settings";

export function loadSettings(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    if (!raw || typeof raw !== "object") return;
    const level = (v: unknown, fallback: number) =>
      typeof v === "number" && v >= 0 && v <= 1 ? Math.round(v * 4) / 4 : fallback;
    settings.music = level(raw.music, settings.music);
    settings.sfx = level(raw.sfx, settings.sfx);
    settings.voice = level(raw.voice, settings.voice);
    if (typeof raw.vibrate === "boolean") settings.vibrate = raw.vibrate;
    if (raw.touchSize === 0 || raw.touchSize === 1 || raw.touchSize === 2) settings.touchSize = raw.touchSize;
    if (typeof raw.calm === "boolean") settings.calm = raw.calm;
    if (typeof raw.lowGfx === "boolean") settings.lowGfx = raw.lowGfx;
    if (raw.style === "soft" || raw.style === "hand") settings.style = raw.style;
    if (typeof raw.tutorialDone === "boolean") settings.tutorialDone = raw.tutorialDone;
  } catch {
    // penyimpanan diblokir atau isinya rusak: pakai bawaan
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // tidak apa-apa: berlaku untuk sesi ini saja
  }
}
