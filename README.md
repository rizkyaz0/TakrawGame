# Takraw Clash

Game sepak takraw arcade di browser: jajanan kampung adu sepak di lapangan 17-an.
Main sendiri, berdua, bertim, atau mabar online lewat kode room.

Main di sini: https://takraw-clash.vercel.app

## Isi game

- 12 karakter jajanan, tiap karakter punya jurus sendiri
- 1 lawan 1, tim 2 lawan 2 dan 3 lawan 3 (kursi kosong diisi CPU)
- Mode arcade (lima lawan berturut-turut), tutorial, dan latihan
- Mabar online lewat kode room, plus penonton usil sebagai pemain ketiga
- 4 arena (kampung, pantai, pasar malam, sekolah) dengan waktu siang, sore, malam
- Keyboard, stick (PS/Xbox), dan tombol layar di HP
- Profil, pencapaian, dan karakter yang terbuka seiring kemenangan
- Bisa dipasang ke layar utama HP dan dibuka tanpa internet

## Menjalankan

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm run dev
```

| Perintah | Guna |
|---|---|
| `npm run dev` | Server pengembangan |
| `npm run dev:lan` | Sama, tapi bisa dibuka dari HP di jaringan yang sama |
| `npm run build` | Periksa tipe lalu bangun versi produksi ke `dist/` |
| `npm test` | Tes inti simulasi |
| `npm run league` | Liga CPU lawan CPU untuk mengukur keseimbangan karakter |
| `npm run audio` | Membuat file suara dengan ElevenLabs (lihat di bawah) |

## Susunan kode

Semua aset dibuat lewat kode: model 3D, tekstur, dan sebagian suara. Tidak ada file model
atau gambar yang dimuat game.

| Berkas | Isi |
|---|---|
| `src/sim.ts` | Simulasi murni dan deterministik (60 Hz): fisika, aturan, jurus, CPU. Tanpa DOM. |
| `src/main.ts` | Alur aplikasi: menu, HUD, mode, tutorial, loop utama |
| `src/render.ts` | Penggambar Three.js: kamera, bola, efek, potret karakter |
| `src/foodchar.ts` | Model dan animasi 12 karakter |
| `src/animator.ts` | Pose dan gerakan badan yang dipakai semua karakter |
| `src/scenery.ts` | Empat arena dan tiga waktu |
| `src/style.ts`, `src/fx.ts` | Shader gambar tangan, garis tepi, partikel |
| `src/input.ts`, `src/touch.ts` | Keyboard, stick, mouse, tombol layar |
| `src/net.ts` | Mabar online (PeerJS/WebRTC) |
| `src/audio.ts` | Pemutar suara: file dari `public/audio/` dengan cadangan sintetis, dan musik |
| `src/settings.ts`, `src/progress.ts` | Pengaturan dan kemajuan pemain (localStorage) |

### Simulasi

`step(state, inputs, specInput)` memajukan permainan satu frame. Input dan state yang sama
selalu memberi hasil yang sama: tidak ada `Math.random` di dalamnya. Pemain bernomor genap
ada di sisi kiri, ganjil di sisi kanan; pemain 0 dan 1 adalah kapten.

### Mabar online

Satu perangkat menjadi host dan menjalankan simulasi. Tamu mengirim tombol yang ditekan
dan menggambar keadaan yang dikirim host. Server PeerJS publik hanya dipakai untuk
mempertemukan perangkat lewat kode room; data permainan mengalir langsung antar-perangkat.

### Suara

Efek suara dan komentator dibuat dengan ElevenLabs dari daftar di
`scripts/audio-list.json`, lalu disimpan sebagai file di `public/audio/`. Kunci API dibaca
dari `.env.local` (tidak ikut ke git) dan tidak pernah sampai ke browser.

```bash
npm run audio -- --dry          # lihat apa yang akan dibuat
npm run audio -- --only=smash   # buat satu
npm run audio                   # buat semua yang belum ada
```

Kalau sebuah file belum ada, kosong, atau gagal dimuat, game memakai suara sintetis.
Musiknya juga sintetis, kecuali ada `public/audio/music_*.mp3`.

## Menyeimbangkan karakter

Tiap karakter punya `charge` di `CHARS` (`src/sim.ts`): pengali kecepatan meter jurusnya
terisi. Karakter yang terlalu sering menang diberi angka lebih kecil. Ukur dengan
`npm run league -- 30 1` (CPU Normal) dan `npm run league -- 30 2` (CPU Sulit).

## Rencana

Lihat [ROADMAP.md](ROADMAP.md).
