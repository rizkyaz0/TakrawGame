// Akun pemain (Supabase): login Google, profil, dan sinkron progres.
// Mode tamu tetap penuh: tanpa env atau tanpa login, semuanya jalan di localStorage seperti biasa.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { applyProgress, loadProgress, mergeProgress, progress, setProgressSavedHook, unlockWinsAll } from "./progress";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const OWNER_KEY = "takraw.progress.owner"; // uid akun yang terakhir disinkronkan ke progres lokal

export const authEnabled = !!URL && !!KEY;
const sb: SupabaseClient | null = authEnabled ? createClient(URL!, KEY!, { auth: { persistSession: true, detectSessionInUrl: true } }) : null;

export interface AccountProfile {
  displayName: string;
  avatar: string;
}

export const account = {
  user: null as User | null,
  profile: null as AccountProfile | null,
  syncing: false,
  error: "" as string,
};

let listener: (() => void) | null = null;
const changed = () => listener?.();

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}
function writeOwner(uid: string): void {
  try {
    localStorage.setItem(OWNER_KEY, uid);
  } catch {
    // diabaikan
  }
}

// Menarik data awan lalu menggabungkannya dengan data lokal; hasilnya ditulis ke dua sisi.
async function syncDown(user: User): Promise<void> {
  if (!sb) return;
  account.syncing = true;
  account.error = "";
  changed();
  try {
    const [prof, data] = await Promise.all([
      sb.from("profiles").select("display_name, avatar").eq("id", user.id).maybeSingle(),
      sb.from("player_data").select("progress").eq("id", user.id).maybeSingle(),
    ]);
    if (prof.error) throw prof.error;
    if (data.error) throw data.error;
    if (prof.data) account.profile = { displayName: prof.data.display_name, avatar: prof.data.avatar };
    const owner = readOwner();
    // Perangkat yang sebelumnya dipakai akun lain: jangan campur, pakai data awan saja.
    const local = owner && owner !== user.id ? null : progress;
    const merged = mergeProgress(local, data.data?.progress);
    applyProgress(merged);
    writeOwner(user.id);
    try {
      localStorage.setItem("takraw.progress", JSON.stringify(progress));
    } catch {
      // diabaikan
    }
    await pushNow();
  } catch (e) {
    account.error = e instanceof Error ? e.message : "Gagal sinkron";
  } finally {
    account.syncing = false;
    changed();
  }
}

async function pushNow(): Promise<void> {
  if (!sb || !account.user) return;
  const uid = account.user.id;
  const [a, b] = await Promise.all([
    sb.from("player_data").update({ progress, unlocked_chars: unlockWinsAll(), updated_at: new Date().toISOString() }).eq("id", uid),
    sb.from("profiles").update({ matches: progress.matches, wins: progress.wins }).eq("id", uid),
  ]);
  if (a.error || b.error) account.error = (a.error ?? b.error)!.message;
}

let timer = 0;
function schedulePush(): void {
  if (!account.user) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void pushNow().then(changed), 2500);
}

export function initAuth(onChange: () => void): void {
  listener = onChange;
  if (!sb) return;
  setProgressSavedHook(schedulePush);
  sb.auth.onAuthStateChange((_event, session) => {
    const u = session?.user ?? null;
    if (!u) {
      account.user = null;
      account.profile = null;
      changed();
      return;
    }
    if (account.user?.id === u.id) return; // pembaruan token biasa
    account.user = u;
    changed();
    // Jangan memanggil Supabase langsung di dalam callback ini (bisa buntu); tunda satu putaran.
    window.setTimeout(() => void syncDown(u), 0);
  });
}

export async function signInGoogle(): Promise<void> {
  if (!sb) return;
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) {
    account.error = error.message;
    changed();
  }
}

export async function signOut(): Promise<void> {
  if (!sb) return;
  await pushNow().catch(() => undefined);
  await sb.auth.signOut();
  // Data lokal tetap ada: jadi tamu lagi dengan progres yang sama.
  loadProgress();
}

// Mengganti nama tampilan. Mengembalikan pesan galat, atau "" bila berhasil.
export async function renameProfile(name: string): Promise<string> {
  if (!sb || !account.user) return "Belum masuk.";
  const n = name.trim();
  if (!/^[A-Za-z0-9_ ]{3,16}$/.test(n)) return "Nama 3–16 karakter: huruf, angka, spasi, atau _.";
  const { error } = await sb.from("profiles").update({ display_name: n }).eq("id", account.user.id);
  if (error) return error.code === "23505" ? "Nama itu sudah dipakai." : error.message;
  if (account.profile) account.profile.displayName = n;
  changed();
  return "";
}
