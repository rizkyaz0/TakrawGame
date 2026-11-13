// Membuat file suara game dengan ElevenLabs, dari daftar di scripts/audio-list.json.
// Dijalankan di komputer pengembang, bukan di browser: kuncinya dibaca dari lingkungan
// (ELEVENLABS_API_KEY) dan tidak pernah ikut ke situs. Hasilnya disimpan di public/audio/
// dan ikut ter-deploy sebagai file biasa.
//
//   npm run audio -- --dry            lihat apa yang akan dibuat, tanpa memanggil ElevenLabs
//   npm run audio -- --only=smash     buat satu (atau beberapa, dipisah koma)
//   npm run audio -- --type=sfx       buat satu jenis: sfx, voice, atau music
//   npm run audio                     buat semua yang belum ada
//   npm run audio -- --force          buat ulang walau filenya sudah ada
//
// Tiap suara yang dibuat memakai kuota akun ElevenLabs.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "audio");
const list = JSON.parse(await readFile(join(root, "scripts", "audio-list.json"), "utf8"));

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const flag = (name) => process.argv.includes(`--${name}`);
const only = arg("only")?.split(",");
const type = arg("type");
const dry = flag("dry");
const force = flag("force");

const fileOf = (item) => join(outDir, `${item.id}.mp3`);
const wanted = list.items.filter(
  (it) => (!only || only.includes(it.id)) && (!type || it.type === type) && (force || !existsSync(fileOf(it))),
);

// SDK mengembalikan aliran data; bentuknya berbeda antar-endpoint, jadi dua-duanya ditangani.
async function toBuffer(audio) {
  const chunks = [];
  if (typeof audio.getReader === "function") {
    const reader = audio.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } else {
    for await (const chunk of audio) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function make(client, item) {
  if (item.type === "sfx") {
    return client.textToSoundEffects.convert({
      text: item.text,
      modelId: "eleven_text_to_sound_v3",
      durationSeconds: item.seconds,
    });
  }
  if (item.type === "voice") {
    return client.textToSpeech.convert(item.voiceId ?? list.voice.voiceId, {
      text: item.text,
      modelId: list.voice.modelId,
      languageCode: list.voice.languageCode,
    });
  }
  if (item.type === "music") {
    return client.music.compose({
      prompt: item.text,
      musicLengthMs: Math.round(item.seconds * 1000),
      modelId: "music_v2_5",
    });
  }
  throw new Error(`jenis tidak dikenal: ${item.type}`);
}

// Daftar file yang benar-benar ada; game memuat ini untuk tahu suara mana yang tersedia.
async function writeIndex() {
  const have = existsSync(outDir) ? (await readdir(outDir)).filter((f) => f.endsWith(".mp3")) : [];
  const ids = new Set(have.map((f) => f.slice(0, -4)));
  const items = list.items.filter((it) => ids.has(it.id)).map((it) => ({ id: it.id, type: it.type }));
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.json"), `${JSON.stringify(items)}\n`);
  return items.length;
}

if (wanted.length === 0) {
  console.log(`Tidak ada yang perlu dibuat. Tersedia: ${await writeIndex()} dari ${list.items.length}.`);
  process.exit(0);
}

console.log(`${dry ? "Akan dibuat" : "Membuat"} ${wanted.length} suara:`);
for (const it of wanted) console.log(`  ${it.type.padEnd(5)} ${it.id}${it.seconds ? ` (${it.seconds} dtk)` : ""}`);
if (dry) process.exit(0);

if (!process.env.ELEVENLABS_API_KEY) {
  console.error("ELEVENLABS_API_KEY belum ada. Jalankan lewat `npm run audio`, yang memuat .env.local.");
  process.exit(1);
}

const client = new ElevenLabsClient();
await mkdir(outDir, { recursive: true });
let failed = 0;
for (const it of wanted) {
  try {
    const buf = await toBuffer(await make(client, it));
    await writeFile(fileOf(it), buf);
    console.log(`  ok    ${it.id} (${Math.round(buf.length / 1024)} KB)`);
  } catch (err) {
    failed++;
    // Pesan error saja; jangan cetak objek permintaan, yang bisa memuat kunci.
    console.error(`  gagal ${it.id}: ${err?.statusCode ?? ""} ${err?.body?.detail?.message ?? err?.message ?? err}`);
  }
}
console.log(`Selesai. Tersedia: ${await writeIndex()} dari ${list.items.length}. Gagal: ${failed}.`);
process.exit(failed > 0 ? 1 : 0);
