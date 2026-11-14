# Rencana Redesign Takraw Clash

Ditulis 14 November 2026 untuk dikerjakan sesi lain (rencananya Sonnet 5.5). Dokumen ini
berdiri sendiri: pembacanya tidak punya percakapan sebelumnya. Baca juga `README.md`
(susunan kode) dan `ROADMAP.md` (apa yang sudah dan belum ada).

Gambar acuan dari pemilik proyek ada di `docs/design/`:

| Berkas | Isi |
|---|---|
| `ref-2-menu-utama.webp` | Menu utama: tombol MAIN besar, lalu Ranked, Arcade, Tutorial, Profile, Pengaturan |
| `ref-5-room-mabar.webp` | Room: Tim Merah dan Tim Biru, kartu pemain, pilih mode, kontrol, lokasi, Mulai |
| `ref-3-masukkan-kode-room.webp` | Mabar online: masukkan kode, daftar room, penunjuk langkah |
| `ref-1-pilih-jagoan-arena.webp` | Pilih jagoan di depan arena, panel statistik miring |
| `ref-4-pilih-jagoan-studio.webp` | Pilih jagoan versi studio: satu karakter di podium, deretan kartu di bawah |

Gambar itu mockup buatan AI. Pakai sebagai acuan tata letak, warna, dan suasana. Jangan
menjiplak piksel demi piksel, dan jangan menganggap teks di dalamnya benar (ada salah ketik).

## Apa yang diminta

1. Smash "tahan-bidik": karakter dan bola mengapung sejenak saat smash kena, pemain mengarahkan.
2. Alur menu baru yang bertahap, dengan room untuk mabar offline dan online.
3. Tampilan 3D kartun dengan pencahayaan sinematik dan kedalaman, seperti gambar acuan.
4. Penonton berbentuk seperti karakter.
5. Jurus baru dan skin.
6. Mode Ranked, dan Profil dengan tombol masuk.

## Urutan kerja

Urutan ini sengaja: yang tidak butuh keputusan dan tidak saling bergantung didahulukan.
Tiap tahap berakhir dengan game yang masih bisa dimainkan, `npm run build` lolos, dan
`npm test` lolos.

| Tahap | Isi | Butuh keputusan pemilik? |
|---|---|---|
| A | Smash tahan-bidik | Tidak |
| B | Alur menu dan room offline | Tidak |
| C | Tampilan 3D kartun | Tidak |
| D | Penonton berbentuk karakter | Tidak |
| E | Jurus baru dan skin | Tidak |
| F | Room online untuk 2v2 dan 3v3 | Tidak |
| G | Akun, profil masuk, Ranked, daftar room | **Ya**: layanan backend dan biayanya |

---

## Tahap A — Smash tahan-bidik

> **Status (14 Nov 2026): selesai di kode, belum dicoba di HP/online sungguhan.** Sim: `aimTimer`, `launchSmash`, `smashDir` di `src/sim.ts`; CPU menahan 3-10 frame; panah bidik di `render.ts`; pose menahan di `animator.ts`; 7 tes baru. Liga 20 pertandingan: Normal selisih 17,3 poin, Sulit 20,2 (sebelumnya 16,4), kehabisan waktu tetap 14-15. Belum disetel.

### Perilaku

Sekarang smash langsung melesat begitu kena. Yang diminta: saat smash **mengenai bola**,
karakter dan bola berhenti mengapung sebentar, pemain memilih arah, lalu bola dilepas.

Tafsiran yang dipakai (pemilik belum mengoreksi; kalau ia mengoreksi, ikuti dia):

- Mengapung dimulai saat smash kena, bukan saat tombol ditekan. Smash yang meleset tetap seperti sekarang.
- Selama mengapung: gravitasi karakter mati, bola menempel di depan kakinya, keduanya diam.
- Arah diambil dari WASD atau stick. Panah di layar menunjukkan arahnya, terlihat semua pemain.
- Bola dilepas saat tombol smash **dilepas**, atau otomatis setelah batas waktu.
- Tekan-lepas cepat = smash langsung seperti sekarang. Permainan cepat tidak boleh hilang.
- Pemain lain **tidak** membeku. Itu harga yang dibayar: lawan dapat waktu bersiap.
- Smash sempurna tetap dinilai dari saat kena, bukan dari lamanya membidik.

Angka awal (setel lewat liga): batas mengapung 24 frame (0,4 detik), minimal 4 frame.

### Pekerjaan

- `src/sim.ts`
  - `Player`: tambah `aimTimer` (sisa frame mengapung) dan `aimPerfect` (hasil timing saat kena).
  - `tryHit`, cabang smash: jangan luncurkan bola; set `aimTimer`, simpan `aimPerfect`, hitung sentuhan dan `rally` seperti biasa, kirim event baru `aimStart`.
  - Fungsi baru `stepAim`: selama `aimTimer > 0` karakter dan bola dipaku; bola dilepas saat tombol smash tidak lagi ditekan (dan minimal sudah lewat) atau timer habis. Rumus arah dan kecepatan memakai yang sekarang ada di cabang smash. Kirim event `smash` di saat lepas.
  - `stepPlayer` dan `stepBall`: lewati gerak dan gravitasi untuk pemain dan bola yang sedang dipaku. Bola yang dipaku tidak bisa disentuh pemain lain.
  - Terhuyung (`stun`) saat membidik: batalkan, bola jatuh biasa.
  - `cpuInput`: tahan tombol smash 3–10 frame (dari hash, jangan `Math.random`), lalu lepas dengan arah yang sama seperti logika sekarang.
- `src/render.ts`: panah bidik di depan karakter selama `aimTimer > 0`; sedikit zoom kamera.
- `src/animator.ts` / `src/foodchar.ts`: pose menahan (kaki terangkat, badan condong) selama membidik.
- `src/main.ts`: suara "tahan" saat `aimStart`; tutorial langkah SMASH menjelaskan tahan lalu arahkan.
- `tests/sim.test.mjs`: tes baru untuk (1) tekan-lepas cepat = perilaku lama, (2) menahan memaku bola dan karakter, (3) lepas menembak ke arah yang ditahan, (4) batas waktu melepas otomatis, (5) simulasi tetap deterministik.

### Selesai kalau

- `npm test` lolos dengan tes baru.
- `npm run league -- 20 1` dan `-- 20 2`: tidak ada lonjakan "kehabisan waktu", selisih karakter tidak lebih buruk dari sekarang (16 poin). Kalau memburuk, setel `charge` di `CHARS`.
- Online tidak perlu diubah: tamu hanya mengirim tombol. Pastikan host dan tamu sama-sama melihat panah.

---

## Tahap B — Alur menu dan room offline

> **Status (14 Nov 2026): B1 dan Room offline selesai; model kursi `Seat` penuh dan pemecahan `main.ts` belum.** B1 = menu bertahap (`titleItems`, `menuNav`). Room = layar `#room` untuk 1v1/2v2/3v3 lawan komputer dan mabar offline (`goRoom`, `renderRoom`, `roomKey` di `src/main.ts`): kartu tiap kursi dengan ganti jagoan, alat, JADI PEMAIN/JADI BOT, lalu arena, waktu, poin, tingkat bot, penonton, MULAI. Dari menu utama ke 1v1 sekarang 4 klik. Batas: baru dua kursi bisa diisi orang (P1 dan satu lagi, lawan atau teman); Arcade, Latihan, dan host online masih memakai layar Kontrol + Pilih Jagoan lama. Belum diuji dengan stick dan di HP.

### Alur

```
MENU UTAMA
├─ MAIN
│   ├─ Lawan Komputer   → pilih 1v1 / 2v2 / 3v3 → ROOM
│   ├─ Mabar Offline    → pilih 1v1 / 2v2 / 3v3 → ROOM
│   └─ Mabar Online
│       ├─ Buat Room    → pilih 1v1 / 2v2 / 3v3 → ROOM (dengan kode)
│       └─ Masukkan Kode → ROOM
├─ RANKED      (tahap G; sebelum itu tampil "segera hadir", jangan tombol mati tanpa penjelasan)
├─ ARCADE
├─ TUTORIAL    (tutorial 6 langkah, lalu latihan bebas di dalamnya)
├─ PROFIL      (statistik dan pencapaian; tombol MASUK muncul di tahap G)
└─ PENGATURAN
```

Tiap layar punya tombol KEMBALI yang terlihat, dan Esc / tombol lingkaran stick melakukan hal yang sama.

### Room (acuan: `ref-5-room-mabar.webp`)

Satu layar menggantikan "Pengaturan Kontrol" yang sekarang:

- Tim Merah di kiri, Tim Biru di kanan, masing-masing 1–3 kartu sesuai mode.
- Tiap kartu: potret jagoan, nama pemain (Pemain 1, Bot, Tamu), alatnya (WASD, Panah, Stick n, Tombol layar), tombol GANTI JAGOAN.
- Kartu kosong: TAMBAH PEMAIN (pilih alat) atau TAMBAH BOT.
- Tengah: pilih mode, lokasi (arena dan waktu), poin menang, tombol MULAI PERTANDINGAN.
- Penonton usil jadi satu slot terpisah di bawah.
- "Lawan Komputer" membuka room yang sama dengan semua kursi selain Pemain 1 sudah diisi bot.

### Pekerjaan

- Ganti model kursi. Sekarang: `devices: [Device, Device]`, `app.humans`, `app.mate`, `app.teamSize`. Ganti dengan satu daftar:
  ```ts
  type Seat = { kind: "human"; device: Device } | { kind: "bot"; level: number } | { kind: "net"; guestId: number } | { kind: "empty" };
  const room = { teamSize: 1 | 2 | 3, seats: Seat[], chars: number[], arena, time, winScore };
  ```
  Nomor kursi = nomor pemain di simulasi (genap kiri, ganjil kanan). `slotOf`, `buildLineup`, dan cabang `team` di loop utama (`update`) disederhanakan memakai daftar ini.
- Pecah `src/main.ts` (lebih dari 2.000 baris) sambil jalan: `src/ui/menu.ts`, `src/ui/room.ts`, `src/ui/select.ts`, `src/ui/hud.ts`. Loop utama dan `handleEvent` tetap di `main.ts`.
- Pilih jagoan: tiap kursi manusia memilih sendiri dari kartu room-nya; bot bisa diatur siapa saja.
- Karakter terkunci (`src/progress.ts`): tetap berlaku untuk kursi manusia lokal.
- Navigasi keyboard, stick, dan sentuhan harus jalan di semua layar baru. Tombol yang bisa diklik memakai `data-tap` (lihat `handleTap`).
- Simpan pilihan terakhir (mode, alat, arena) di localStorage.

### Selesai kalau

- Dari menu utama ke pertandingan 1v1 lawan komputer paling banyak 4 klik.
- 2v2 dengan dua orang di satu keyboard dan dua bot bisa dimulai dari room.
- Dua kursi tidak bisa memakai alat yang sama; pesannya jelas.
- Semua layar punya KEMBALI. Tidak ada layar buntu.

---

## Tahap C — Tampilan 3D kartun

> **Status (14 Nov 2026): C1 selesai, sisanya belum.** C1 = pilihan "Gaya" di Pengaturan (KARTUN 3D bawaan / GAMBAR TANGAN): `setStyleKind` di `src/style.ts` (peta gradasi halus, kilap dan cahaya tepi di shader, garis tepi lebih tipis), `Renderer.setStyle` di `src/render.ts` (ACES, cahaya tepi, bayangan lebih lembut, bloom tipis, vinyet dan warna lewat `EffectComposer`; mati otomatis saat Grafis = Hemat atau fps rata-rata di bawah ±38). Belum: tribun kayu bertingkat, buram kedalaman di menu, panel HUD bersudut bulat, penyesuaian karakter (sarung tangan/mata), model 3DGarden untuk Kampung/Sekolah/Pasar Malam. Belum diukur di HP; di panel browser (render perangkat lunak) gaya baru ±1,8x lebih lambat dari gaya lama.

### Arah baru

Sekarang gayanya "gambar tangan": bahan kartun bertingkat, arsiran, garis tepi tinta
(`src/style.ts`). Gambar acuan memakai gaya lain: 3D kartun halus dan mengilap, cahaya
hangat, bayangan lembut, latar buram.

Pemilik memilih arah baru ini. Gaya lama jangan dihapus: jadikan pilihan "Gaya: Kartun 3D /
Gambar tangan" di Pengaturan, supaya bisa dibandingkan dan dikembalikan.

### Yang realistis

Three.js di browser tidak akan menyamai gambar acuan, karena gambar itu hasil render
offline. Yang bisa dicapai: mendekati suasananya. Katakan ini apa adanya kepada pemilik
dan tunjukkan tangkapan layar perbandingan; jangan mengklaim "sama".

### Pekerjaan

- `src/style.ts`: pabrik bahan kedua. `toon()` tetap; tambah `soft()` berbasis `MeshStandardMaterial` (kasar 0,45–0,6, tanpa arsiran). Semua pemanggil `toon()` lewat satu fungsi `mat()` yang memilih sesuai gaya.
- Cahaya (`src/render.ts`): peta lingkungan (`RoomEnvironment` lewat `PMREMGenerator`), cahaya utama hangat, cahaya tepi dari belakang, `ACESFilmicToneMapping`, bayangan lembut.
- Pasca-proses (`EffectComposer` dari `three/addons`): bloom tipis, buram kedalaman (hanya di menu dan pilih jagoan; di pertandingan cukup latar yang sedikit buram), vinyet, koreksi warna. **Matikan semuanya saat Grafis = Hemat.**
- Karakter (`src/foodchar.ts`): di gaya baru, garis tepi tipis atau hilang; sarung tangan dan sepatu lebih besar dan bulat; mata lebih mengilap. Bentuk badan jangan diubah: pemilik sudah menyetujui maskot jajanan.
- Arena: tribun kayu bertingkat di belakang lapangan (lihat `ref-2`), supaya ada kedalaman. Model properti dari 3DGarden boleh dipakai (lihat `src/models.ts` dan arena Pantai sebagai contoh).
- HUD dan menu (`index.html`): panel bersudut bulat dengan bayangan lembut, papan kayu untuk judul layar, ikon di tombol. Acuan: `ref-1`, `ref-2`.
- Ukur performa: catat fps di laptop dan di HP sebelum dan sesudah. Kalau HP turun di bawah 40 fps, pasca-proses otomatis mati.

### Model 3DGarden untuk arena lain

Arena Pantai sudah memakai 21 model dari https://www.3dgarden.app (koleksi Beach), lewat
`src/models.ts` dan `loadPantai` di `src/scenery.ts`. Pemilik menyukai hasilnya. Lanjutkan
ke arena lain dengan pola yang sama: properti buatan kode jadi cadangan, model menggantikannya
begitu selesai dimuat.

| Arena | Koleksi | Contoh model |
|---|---|---|
| Kampung | Street furniture, Nature | tiang listrik, lampu jalan, bangku, tong sampah, kotak pos, pohon, rumput, bunga |
| Sekolah | Street furniture, Nature | rak sepeda, bangku taman, halte, pohon, pagar |
| Pasar Malam | Candy shop, Casino, Funny parkour | donat, lolipop, toples permen, lampu gantung, mesin arcade kecil, pemutar berwarna |
| Lemparan penonton | Food | semangka, telur ceplok, roti, cabai |

- Server MCP `3dgarden` sudah terpasang di proyek ini. Pakai `get_collection` untuk daftar dan ukuran, `preview_scene` untuk memperlihatkan pilihan ke pemilik, `download_model` untuk mengambil file ke `public/models/`.
- Sebut nama, sumber, dan ukuran sebelum mengunduh. Jangan mengunduh seluruh koleksi; ambil yang dipakai saja.
- Gapura, gerobak bakso, dan benda khas Indonesia lain tidak ada di katalog: tetap buatan kode.
- Model dimuat hanya saat arenanya dipakai. Saat Grafis = Hemat, pakai cadangan buatan kode.
- Lisensinya: bebas dipakai dan diubah, termasuk komersial; file modelnya tidak boleh dijual lagi.

### Desain karakter baru (lembar acuan dari pemilik, 14 November 2026)

Pemilik membuat lembar karakter (depan, perspektif, samping, belakang, pose-A) untuk 8
karakter: Bang Sosis, Pak Ote-Ote, Bung Jagung, Dek Lilin, Kak Pisang, Mas Tahu, Pak Bakso,
Mbak Lontong. Berkas: `docs/design/characters/<nama>-lembar.jpg`, dan potongan tiap tampak
`<nama>-depan|perspektif|samping|belakang.jpg`. Ini **desain target** yang menggantikan
tampilan karakter sekarang. Ciri yang seragam:

- Badan jajanan halus dan mengilap (gaya 3D kartun, bukan arsiran).
- Wajah besar: mata putih dengan pupil hitam bersinar, alis tebal, pipi merah muda, mulut terbuka.
- Lengan dan kaki **berwarna sama dengan badan** (bukan hitam), tipis dan lentur.
- Sarung tangan putih besar **berjari** (bukan bola).
- Sepatu kets dengan tali, warna aksen sesuai karakter.
- Tas ransel kecil di punggung, warna beda tiap karakter.
- Hiasan kepala khas tiap karakter (topi kupluk, blangkon/ikat kepala batik, caping, rambut jagung, api lilin).
- Pak Ote-Ote (ote-ote dengan udang dan ikat kepala batik) belum ada di roster: itu karakter ke-13. Tanyakan pemilik apakah ditambahkan atau menggantikan salah satu.
- Empat karakter lain (Om Sate, Mbok Klepon, Cak Kerupuk, Pakde Tempe, Neng Cendol) belum punya lembar.
- Tulisan di lembar ("berdasarkan Clash", judul) adalah sisa pembuatan gambar; abaikan.

**Status (14 November 2026):** gaya v2 lewat kode sudah dipasang di 7 karakter yang punya
lembar (Bang Sosis, Mbak Lontong, Pak Bakso, Mas Tahu, Kak Pisang, Dek Lilin, Bung Jagung).
Cara kerjanya: `BodySpec.v2` di `src/foodchar.ts` (warna lengan-kaki, sepatu, ransel), dengan
`buildGlove`, `buildSneaker`, `buildBackpack`, dan wajah v2. Karakter tanpa `v2` tetap bergaya
lama, jadi lima karakter tanpa lembar (Om Sate, Mbok Klepon, Cak Kerupuk, Pakde Tempe, Neng
Cendol) belum diubah. Dek Lilin sekarang berbentuk lilin (mengikuti lembar), bukan es lilin.
Belum: proporsi ramping dan kaki panjang (terkunci di fisika), bahan 3D mengilap dan cahaya
(Tahap C), dan Pak Ote-Ote.

Yang berubah di kode bila desain ini dipakai (urut dari yang termurah):

1. `foodchar.ts`: warna lengan dan kaki mengikuti badan; tangan berjari; sepatu kets bertali; ransel; alis dan pipi. Murni kode, tanpa AI, dan menjaga animasi yang sudah jalan.
2. Badan lebih detail (tekstur, topi, hiasan): dari kode atau dari model AI (lihat di bawah).
3. Ganti badan dengan model AI hanya kalau hasilnya jelas lebih bagus dari langkah 1 dan 2.

### Badan karakter dari model 3D hasil AI (uji coba)

Pemilik membuat akun Meshy, Tripo, Hunyuan3D, dan 3D AI Studio (server MCP
`3daistudio` sudah didaftarkan di proyek ini; perlu login lewat `/mcp`). Idenya: badan
jajanan dibuat halus oleh model AI.

**Masalahnya animasi.** Karakter digerakkan `src/animator.ts` lewat sendi terpisah: pinggul,
lutut, bahu, siku, tulang punggung, dan kaki yang bisa melar. Satu model AI utuh tidak
punya sendi itu. Jadi yang diganti **hanya badannya**; wajah (mata yang mengikuti bola),
tangan, kaki, sarung tangan, dan sepatu tetap buatan kode dan tetap dipasang di badan.

- Gambar acuan badan tanpa wajah dan tangan-kaki sudah dibuat: `docs/design/bodies/<nama>-depan.png` dan `-miring.png` (12 karakter, 768 px, latar transparan). Dibuat dengan `new FoodCharacter(id, true)` dan `renderer.portrait(id, 768, true, front)`.
- Uji dulu **satu** karakter (Bang Sosis) di satu layanan sebelum membuat yang lain. Bandingkan hasilnya dengan badan buatan kode lewat tangkapan layar.
- Pasang hasilnya (GLB) lewat `src/models.ts`; di `buildBody`, kasus karakter itu memuat GLB kalau ada dan memakai bentuk buatan kode sebagai cadangan.
- Titik pasang: `spec.faceX`, `faceY`, `armY`, `armZ`, `legZ` di `BodySpec` harus disetel ulang ke bentuk model baru.
- Syarat model: satu mesh, titik asal di dasar badan, menghadap +x, di bawah 5.000 segitiga, tekstur satu atlas kecil. Tanpa wajah, tangan, dan kaki.
- Model yang sudah berpose atau berwajah dari AI tidak dipakai untuk pertandingan.
- Kredit layanan berbayar dipakai pemilik: sebut perkiraan biaya sebelum membuat model.

### Larangan

- Jangan memakai lambang Garuda Pancasila seperti di `ref-2`. Pemakaian lambang negara diatur undang-undang; di luar keahlian kita untuk menilai boleh-tidaknya, jadi hindari.
- Bendera merah putih dipakai sewajarnya sebagai hiasan 17-an (sudah ada), tidak diinjak, tidak dicoret, tidak jadi tekstur lantai.
- Monas sebagai siluet latar boleh.
- Jangan menyalin karakter, UI, atau aset game lain.

---

## Tahap D — Penonton berbentuk karakter

- Ganti penonton kapsul di `src/scenery.ts` (`buildCrowd`) dengan versi kecil dan sederhana dari 12 jajanan: badan dan wajah saja, tanpa tangan-kaki beranimasi.
- Ambil bentuk badan dari `FoodCharacter.buildBody`; pisahkan jadi fungsi yang bisa dipanggil tanpa membuat seluruh karakter.
- Pakai `InstancedMesh` per jenis badan bila memungkinkan. Penonton bertambah (tribun bertingkat di tahap C), jadi jumlah panggilan gambar harus dijaga.
- Tetap melompat saat sorakan (`cheer`) dan memantul mengikuti ketegangan.
- Karakter yang sedang bertanding tidak muncul di tribun.

Selesai kalau: fps di HP tidak turun lebih dari 10% dibanding penonton lama.

---

## Tahap E — Jurus baru dan skin

### Jurus

Sekarang ada 5 jenis (`fire`, `curve`, `zigzag`, `meteor`, `ghost`) untuk 12 karakter. Lima
karakter terakhir memakai jenis lama dengan nama baru. Tambah jenis baru supaya tiap
karakter punya jurus yang benar-benar beda. Usulan (pilih yang paling enak dimainkan):

| Jenis | Perilaku |
|---|---|
| `split` | Bola terbelah jadi tiga bayangan; hanya satu yang asli |
| `boomerang` | Melewati net, lalu berbalik arah sekali di udara |
| `bounce` | Memantul sekali di lantai lawan tanpa dihitung poin, baru jatuh di pantulan kedua |
| `freeze` | Bola berhenti di udara setengah detik di atas lawan, lalu jatuh |
| `spin` | Melengkung ke samping net lalu membelok tajam ke bawah |
| `heavy` | Lambat tapi tidak bisa di-smash balik; hanya bisa diterima |
| `rain` | Bola naik, lalu jatuh di salah satu dari tiga titik yang ditandai sesaat sebelumnya |

Tiap jenis baru butuh: logika di `tryHit` dan `stepBall` (`src/sim.ts`), cara CPU
menghadapinya (`cpuInput`), efek di `src/render.ts` dan `src/fx.ts`, deskripsi di
`SPECIAL_DESC` (`src/main.ts`), satu tes, lalu disetel lewat liga.

### Skin

- Tiap karakter 3 skin: bawaan, satu variasi warna, satu variasi tema (misalnya 17-an, pantai, malam minggu) dengan hiasan kepala berbeda.
- `src/foodchar.ts`: `new FoodCharacter(charId, skinId)`. Skin mengubah warna badan, warna aksen, dan hiasan (`wobble`).
- Dibuka lewat `src/progress.ts`: menang dengan karakter itu 3 dan 8 kali.
- Dipilih di kartu room atau layar pilih jagoan. Skin hanya tampilan: tidak mengubah statistik, dan **tidak masuk simulasi** (`sim.ts` tidak boleh tahu soal skin).
- Online: kirim `skinId` tiap kursi bersama susunan karakter.

---

## Tahap F — Room online untuk tim

Sekarang online hanya 1v1 plus penonton (`src/net.ts`, kursi P1, P2, penonton).

- Setelah model kursi di tahap B ada, kursi `net` bisa di kursi mana pun.
- Host menyiarkan daftar kursi lengkap; tamu menampilkan room yang sama (hanya-baca, kecuali kartu miliknya).
- Tamu memilih jagoan dan skin dari kartunya; host mengatur mode, lokasi, dan bot.
- Batas tamu naik dari 4 ke 6 (5 pemain + penonton usil).
- Jeda otomatis saat pemain putus, dan kursi kembali saat ia masuk lagi: pertahankan.

Uji dengan beberapa tab seperti sebelumnya (lihat "Cara menguji").

---

## Tahap G — Akun, Ranked, daftar room (butuh keputusan)

Tiga hal di gambar acuan tidak bisa dibuat tanpa server: tombol masuk, Ranked, dan
"Daftar Room". Sekarang game ini situs statis; semua data ada di perangkat pemain.

Keputusan yang harus diambil pemilik sebelum tahap ini dimulai:

1. **Layanan backend.** Butuh login, basis data, dan daftar room. Tawarkan pilihan dengan
   biayanya; jangan memilih sendiri. Kalau proyek sudah di Vercel, lihat dulu pilihan di
   Vercel Marketplace.
2. **Cara masuk**: Google saja, atau juga email.
3. **Seberapa serius Ranked.** Sekarang simulasi jalan di perangkat host, jadi host bisa
   curang. Ranked yang jujur butuh simulasi di server (biaya dan kerja jauh lebih besar).
   Ranked "santai" (hasil dilaporkan kedua pemain, dicatat kalau cocok) lebih murah tapi
   bisa diakali. Jelaskan dua-duanya.
4. **Kebijakan privasi** (`public/privasi.html`) wajib diperbarui sebelum login dirilis.

Sebelum keputusan ada: tombol RANKED tampil "segera hadir", PROFIL tetap memakai data lokal.

---

## Cara menguji (penting)

- Panel browser tidak bisa diandalkan untuk waktu nyata. Bekukan loop dan majukan sendiri:
  `__game.debug.manual = true`, lalu panggil `__game.update(T)` berulang dengan `T` naik 16,7.
  Jangan lebih dari ±400 frame per panggilan skrip: lebih dari itu kena batas waktu.
- `window.__game` membuka `state`, `app`, `menuKey`, `renderer`, `net`, `devices`.
- Online: dua tab, satu host satu tamu, masing-masing dipompa dengan `setInterval`.
- Simulasi tanpa browser: `node --experimental-strip-types --no-warnings <skrip>.mjs` yang mengimpor `src/sim.ts`.
- Tangkapan layar setelah tiap perubahan tampilan, di ukuran laptop dan di 760×360 (HP mendatar).
- Laporkan apa adanya: yang belum dicoba di HP sungguhan, sebut belum.

## Aturan kerja pemilik proyek

- Bahasa Indonesia santai, jawaban langsung dan ringkas.
- **Commit dan push hanya kalau diminta.** Pola yang biasa: selesai → tanya → "Ya, push".
- Push ke `main` langsung ter-deploy ke https://takraw-clash.vercel.app.
- Commit memakai nama `rizkyaz0` dan email noreply GitHub yang sudah terpasang di repo; jangan diganti.
- Jangan membaca atau mencetak `.env.local` (kunci ElevenLabs).
- Unduhan file baru: sebut sumber, nama, dan ukurannya, minta izin.
- Aset dibuat lewat kode Three.js. Model properti dari 3DGarden boleh; karakter tetap buatan sendiri.

## Kalau butuh gambar buatan AI

Pemilik punya akun Google berbayar dan bisa membuat gambar sendiri. Yang berguna untuk game ini:

- Latar menu (lukisan arena, tanpa karakter dan tanpa teks), 1920×1080.
- Ikon tombol menu (piala, buku, roda gigi) dengan gaya seragam, latar transparan.
- Logo "TAKRAW CLASH".

Minta pemilik menaruh hasilnya di `public/ui/`. Gambar tidak bisa menggantikan model 3D di
dalam pertandingan: karakter dan arena tetap harus dibuat sebagai model.
