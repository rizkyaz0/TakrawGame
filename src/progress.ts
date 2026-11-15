// Kemajuan pemain di perangkat ini: statistik, pencapaian, dan karakter yang terbuka.
// Disimpan di localStorage; tidak ada akun dan tidak ada yang dikirim ke mana pun.

export const progress = {
  matches: 0,
  wins: 0,
  perfectSmash: 0,
  perfectReceive: 0,
  specials: 0,
  bestRally: 0,
  shutouts: 0, // menang tanpa kebobolan
  teamWins: 0,
  arcadeBest: 0, // babak arcade terjauh yang dimenangkan
  arcadeClears: 0,
  arenas: [] as string[], // arena yang pernah dimainkan
  winsByChar: {} as Record<string, number>,
  skins: {} as Record<string, number>, // skin terakhir yang dipilih per karakter
  achievements: [] as string[],
};

export type Progress = typeof progress;

const KEY = "takraw.progress";

export function loadProgress(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Progress> | null;
    if (!raw || typeof raw !== "object") return;
    for (const k of Object.keys(progress) as Array<keyof Progress>) {
      const v = raw[k];
      const cur = progress[k];
      if (typeof cur === "number" && typeof v === "number" && Number.isFinite(v) && v >= 0) {
        (progress[k] as number) = Math.floor(v);
      } else if (Array.isArray(cur) && Array.isArray(v)) {
        (progress[k] as string[]) = v.filter((x): x is string => typeof x === "string").slice(0, 64);
      } else if ((k === "winsByChar" || k === "skins") && v && typeof v === "object" && !Array.isArray(v)) {
        for (const [name, n] of Object.entries(v)) {
          if (typeof n === "number" && n >= 0) progress[k][name] = Math.floor(n);
        }
      }
    }
  } catch {
    // penyimpanan diblokir atau isinya rusak: mulai dari nol
  }
}

export function saveProgress(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // tidak apa-apa: berlaku untuk sesi ini saja
  }
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  done(p: Progress): boolean;
  count?(p: Progress): [number, number]; // kemajuan: sekarang, target
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first", name: "Sepakan Pertama", desc: "Menangkan satu pertandingan", done: (p) => p.wins >= 1 },
  { id: "ten", name: "Langganan Menang", desc: "Menangkan 10 pertandingan", done: (p) => p.wins >= 10, count: (p) => [p.wins, 10] },
  { id: "sharp", name: "Kaki Emas", desc: "25 smash sempurna", done: (p) => p.perfectSmash >= 25, count: (p) => [p.perfectSmash, 25] },
  { id: "wall", name: "Tembok Kampung", desc: "25 terima sempurna", done: (p) => p.perfectReceive >= 25, count: (p) => [p.perfectReceive, 25] },
  { id: "jurus", name: "Jagoan Jurus", desc: "Kenakan 30 jurus", done: (p) => p.specials >= 30, count: (p) => [p.specials, 30] },
  { id: "rally", name: "Reli Maraton", desc: "Reli sepanjang 20 pukulan", done: (p) => p.bestRally >= 20, count: (p) => [p.bestRally, 20] },
  { id: "clean", name: "Bersih Tanpa Noda", desc: "Menang tanpa kebobolan", done: (p) => p.shutouts >= 1 },
  { id: "team", name: "Kompak Selalu", desc: "Menangkan 3 pertandingan tim", done: (p) => p.teamWins >= 3, count: (p) => [p.teamWins, 3] },
  { id: "arcade", name: "Juara Arcade", desc: "Tamatkan mode arcade", done: (p) => p.arcadeClears >= 1 },
  { id: "tour", name: "Keliling Kampung", desc: "Main di keempat arena", done: (p) => p.arenas.length >= 4, count: (p) => [p.arenas.length, 4] },
  {
    id: "all",
    name: "Sahabat Semua Jajanan",
    desc: "Menang dengan 6 karakter berbeda",
    done: (p) => Object.keys(p.winsByChar).length >= 6,
    count: (p) => [Object.keys(p.winsByChar).length, 6],
  },
];

// Karakter ke-8 sampai ke-12 terbuka seiring jumlah kemenangan.
const UNLOCK_AT: Record<number, number> = { 7: 1, 8: 2, 9: 4, 10: 6, 11: 9 };
export const unlockWins = (charId: number) => UNLOCK_AT[charId] ?? 0;
export const isUnlocked = (charId: number) => progress.wins >= unlockWins(charId);

// Memeriksa pencapaian baru; mengembalikan yang baru saja tercapai.
export function checkAchievements(): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !progress.achievements.includes(a.id) && a.done(progress));
  for (const a of fresh) progress.achievements.push(a.id);
  return fresh;
}
