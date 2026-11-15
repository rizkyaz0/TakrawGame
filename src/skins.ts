// Skin karakter: tampilan saja. Simulasi (sim.ts) tidak tahu soal skin.
// Tiap karakter punya 3: bawaan, variasi warna, dan variasi tema dengan hiasan kepala.

import { progress } from "./progress";
import { CHARS } from "./sim";

export interface SkinDef {
  name: (charId: number) => string;
  need: number; // kemenangan dengan karakter itu yang dibutuhkan
}

export const THEMES = ["17-an", "Pantai", "Malam Minggu"] as const;
export const SKINS: readonly SkinDef[] = [
  { name: () => "Bawaan", need: 0 },
  { name: () => "Warna Lain", need: 3 },
  { name: (c) => `Tema ${THEMES[c % THEMES.length]}`, need: 8 },
];

export const winsWith = (charId: number): number => progress.winsByChar[CHARS[charId].name] ?? 0;
export const skinUnlocked = (charId: number, skin: number): boolean => winsWith(charId) >= (SKINS[skin]?.need ?? 99);

// Skin yang dipilih terakhir untuk karakter ini (kalau masih terbuka).
export function savedSkin(charId: number): number {
  const s = progress.skins[CHARS[charId].name] ?? 0;
  return skinUnlocked(charId, s) ? s : 0;
}

// Skin berikutnya yang terbuka, memutar dari skin sekarang.
export function nextSkin(charId: number, from: number, dir: number): number {
  for (let n = 1; n <= SKINS.length; n++) {
    const k = (from + dir * n + SKINS.length * 4) % SKINS.length;
    if (skinUnlocked(charId, k)) return k;
  }
  return 0;
}

// Petunjuk cara membuka skin yang masih terkunci, atau "" kalau semuanya sudah terbuka.
export function skinHint(charId: number): string {
  const w = winsWith(charId);
  const next = SKINS.findIndex((s) => w < s.need);
  if (next < 0) return "";
  return `Skin ${SKINS[next].name(charId)}: menang ${SKINS[next].need}× dengan ${CHARS[charId].name} (baru ${w}×).`;
}
