# Rencana Online: Mabar, Ranked, Papan Skor, Toko, Gacha

Status: **usulan, belum ada yang dikerjakan.** Ini menggantikan Tahap G di `REDESIGN_PLAN.md`
dan Tahap 5–6 di `ROADMAP.md` untuk bagian online. Keputusan pemilik ada di bagian akhir.

## Titik awal (yang sudah ada)

- `src/sim.ts` murni dan deterministik (60 Hz, tanpa DOM, tanpa `Math.random`). Ini aset terbesar:
  simulasi yang sama bisa dijalankan di server atau untuk memverifikasi ulang pertandingan.
- Online sekarang: PeerJS, host memegang simulasi, tamu hanya menerima keadaan. Server PeerJS
  publik gratis, tanpa akun. Host bisa curang dan koneksi bisa putus kapan saja.
- Profil, statistik, 11 pencapaian, dan 5 karakter yang dibuka dengan menang: semua di `localStorage`.
- Hosting: Vercel (situs statis). Belum ada basis data, login, atau server.

## Prinsip

1. **Jangan pay-to-win.** Yang dijual atau diundi hanya kosmetik dan karakter dengan kekuatan
   setara. Karakter baru diseimbangkan dengan `npm run league` sebelum masuk undian.
2. **Gacha tanpa uang nyata dulu.** Mata uangnya didapat dari bermain. Uang nyata untuk undian
   acak punya risiko hukum dan aturan toko aplikasi, jadi ditunda sampai ada keputusan sadar.
3. **Peluang selalu ditampilkan dan ada garansi (pity).**
4. **Server hanya dibangun saat dibutuhkan**, urut dari yang paling murah dan paling terasa.

## Tahap O1 — Fondasi akun (±1–2 minggu)

- Backend: satu layanan yang memberi login, basis data, dan realtime. Pilihan (harga cek ulang
  sebelum memilih): **Supabase** (Auth Google + Postgres + Realtime, paket gratis cukup untuk
  mulai) atau Neon + Auth lewat Vercel Marketplace.
- Login: Google, plus **tamu** (tetap bisa main; data lokal digabung saat login).
- Profil awan: nama unik, avatar, statistik, pencapaian, karakter terbuka. Impor data
  `localStorage` yang ada saat pertama login.
- Perbarui `public/privasi.html` sebelum login dirilis. Tambah ketentuan pakai.

Selesai kalau: login di dua perangkat menampilkan profil yang sama.

## Tahap O2 — Mabar online yang matang (±2 minggu)

- Ganti PeerJS publik dengan **server perantara sendiri** (WebSocket; kandidat: PartyKit atau
  Cloudflare Durable Objects, satu "ruang" per room, biaya sangat kecil untuk 2–6 pemain).
- Kode room, **daftar room**, **cari lawan cepat** (antrean tanpa peringkat), kunci room,
  keluarkan tamu, emote cepat, indikator ping, sambung ulang tanpa kehilangan pertandingan.
- Lobi yang sudah ada (slot kosong + "Jadikan Bot") dipakai apa adanya; tambah tim 2v2 dan 3v3 online.
- Prediksi gerakan untuk pemain sendiri di sisi tamu (supaya terasa tanpa jeda).

Selesai kalau: dua orang di kota berbeda main 10 pertandingan berturut-turut tanpa putus.

## Tahap O3 — Ranked dan papan skor (±2–3 minggu)

Pilihan kejujuran (satu dipilih pemilik):

| Pilihan | Cara kerja | Biaya | Kelemahan |
|---|---|---|---|
| A. Ranked santai | Kedua pemain melapor skor; dicatat bila cocok | Paling murah | Bisa diakali berdua |
| **B. Server memegang simulasi (disarankan)** | Server perantara dari O2 menjalankan `sim.ts`; pemain hanya kirim input | Kecil: simulasi ringan | Perlu prediksi di klien agar terasa mulus |
| C. Verifikasi ulang | Host merekam input, server mengulang simulasi | Kecil | Host dan tamu bisa berkolusi memalsukan log |

Karena `sim.ts` sudah murni, **B** hampir gratis secara kode: modul yang sama dijalankan di Node.

- Peringkat: Elo atau Glicko-2, divisi bernama jajanan (Kerupuk, Bakwan, Risol, Martabak, Sate…),
  musim 6–8 minggu dengan reset lunak dan hadiah kosmetik.
- Matchmaking berdasarkan peringkat, dengan jendela yang melebar seiring waktu tunggu.
- Papan skor: global, bulanan, dan teman. Tampil di menu RANKED yang sekarang "segera".
- Perlindungan: batas laporan, penalti keluar di tengah, sembunyikan nama tidak pantas.

Selesai kalau: seorang pemain baru bisa mendapat lawan sepadan dalam satu menit dan naik divisi.

## Tahap O4 — Toko kosmetik (±2 minggu)

- Mata uang lunak **Koin**: didapat dari menang, tantangan harian, pencapaian, dan naik divisi.
- Dijual: warna/kostum karakter (`SKIN` yang sudah ada), topi, efek tendangan, emote, bingkai
  profil, tema arena. Toko harian berputar plus daftar tetap.
- Inventaris dan kepemilikan disimpan di server (bukan `localStorage`).
- Opsional nanti: battle pass musiman (jalur gratis dan jalur berbayar, hanya kosmetik).

## Tahap O5 — Karakter rahasia dan gacha (±2 minggu setelah O4)

- Mesin undian memakai Koin atau "Tiket" hasil bermain. Peluang tampil jelas, ada garansi
  (mis. pasti dapat karakter rahasia dalam 60 putaran).
- Karakter rahasia: kekuatan setara karakter lain (diukur dengan league), jurus unik, tampilan
  mencolok. Duplikat berubah jadi pecahan untuk membeli kosmetik.
- Jalur lain untuk membuka karakter rahasia tanpa keberuntungan: pencapaian khusus, supaya tidak
  semata-mata soal peluang.
- **Uang nyata untuk undian: jangan sekarang.** Kalau nanti dipertimbangkan, perlu: usia pemain,
  aturan loot box di Indonesia dan toko aplikasi, pembayaran (Midtrans/Xendit), dan penyedia
  yang jelas. Jalur aman: jual kosmetik langsung (bukan acak) dengan uang nyata.

## Tahap O6 — Alasan kembali (berjalan terus)

Tantangan harian dan mingguan, turnamen akhir pekan, tayangan ulang dan bagikan klip,
tombol lapor, moderasi nama, ketentuan komunitas, data pemakaian dasar dan laporan error.

## Urutan dan risiko

`O1 → O2 → O3` adalah jalur wajib; `O4` dan `O5` bisa mulai begitu `O1` ada karena tidak
butuh server pertandingan. Risiko terbesar: latensi di O2/O3 (uji dengan dua kota berbeda sebelum
rilis), kecurangan input macro (tidak bisa dicegah penuh; cukup lewat deteksi pola dan laporan),
dan beban moderasi. `main.ts` perlu dipecah (menu, HUD, jaringan, loop) sebelum O2 supaya
kode jaringan baru tidak menumpuk di satu berkas.

## Karakter baru dari pemilik (`60e258220bc7bedb5c9e0fef03188317.glb`)

Hasil pemeriksaan file (belum dilihat bentuknya karena terlalu berat):

- 71,6 MB, **1.500.004 segitiga**, satu mesh statis, **tanpa rig dan tanpa animasi**.
- Tiga tekstur PNG 4096×4096 (±26 MB): normal, warna, metalik-kasar. Atlas warna terlihat
  noisy seperti hasil generator 3D, jadi kemungkinan perlu dibersihkan.
- Model berdiri sepanjang sumbu Z (tinggi ±1,17), jadi perlu diputar.
- Target pakai: **15–25 ribu segitiga, tekstur 1024², di bawah ±500 KB** seperti 13 karakter lain.
  Langkah: retopo/decimate, bake ulang tekstur ke 1024², lalu lewat auto-skinning `aibody.ts`
  (13 tulang). Alat: Blender, `gltf-transform`, atau `low_poly_model` di 3D AI Studio (paket berbayar).
- Karakter harus tetap sesuai arah visual: maskot jajanan lucu buatan kode, bukan humanoid.
  Perlu tahu dulu apa karakternya.

## Keputusan pemilik (16 Nov 2026)

1. **Backend**: Supabase.
2. **Login**: Google + tamu.
3. **Ranked**: server memegang simulasi (`sim.ts` dijalankan di server perantara).
4. **Uang nyata**: belum ada. Toko dan gacha hanya memakai Koin hasil bermain.

Belum diputuskan: anggaran bulanan server, dan soal karakter GLB (bentuk, nama, karakter rahasia
atau biasa).

Langkah berikutnya: mulai Tahap O1 (akun). Sebelum itu pemilik perlu membuat proyek Supabase
dan mengaktifkan login Google; jangan membagikan kunci rahasia di chat, cukup simpan di `.env.local`.
