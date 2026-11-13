# Rencana Takraw Clash

Rencana dari prototipe ke produk yang bisa dimainkan orang banyak. Urutannya sengaja:
fondasi dulu, baru fitur yang mendatangkan pemain. Tiap tahap berakhir dengan sesuatu
yang bisa dicoba di situs live.

Tanda: `[ ]` belum, `[x]` selesai. "Selesai kalau" adalah bukti yang harus ada sebelum
sebuah tahap dianggap beres.

## Tahap 0 — Tutup yang menggantung

- [x] Push perbaikan tombol HP, pilihan alat "HP · Tombol Layar", dan tombol menu baru
- [ ] Uji di HP sungguhan: tombol layar, main lagi, layar penuh
- [ ] Uji mabar online di dua jaringan berbeda (WiFi dan data seluler), catat delay
- [ ] Uji stick PS/Xbox sungguhan di komputer dan di HP
- [ ] Dengarkan semua efek suara yang ada, catat yang jelek

Selesai kalau: semua poin di atas dicoba orang sungguhan dan temuannya tercatat.

## Tahap 1 — Suara (ElevenLabs)

Kunci ElevenLabs tidak boleh ikut ke browser, jadi suara dibuat sekali lewat skrip di
komputer pengembang, disimpan sebagai file di `public/audio/`, lalu dimuat game.

- [x] Skrip `scripts/make-audio` yang membuat file suara dari daftar di satu berkas
- [x] Efek suara dasar (16 file). Belum: jurus per jenis; `touch`, `receive`, `bonk` perlu dibuat ulang
- [ ] Suara karakter: seruan pendek tiap jajanan (smash, jurus, menang, kalah)
- [x] Komentator dasar (6 kalimat). Belum: "Sempurna!" dan nama jurus
- [x] Musik: menu, pertandingan, match point (sintetis; file ElevenLabs butuh akun berbayar)
- [x] Pemutar suara baru yang memuat file, dengan cadangan ke suara sintetis lama
- [x] Pengatur volume terpisah (musik, efek, suara) dan tombol bisu

Selesai kalau: game bersuara penuh di HP dan komputer, ukuran unduhan suara di bawah
3 MB, dan game tetap jalan kalau file suara gagal dimuat.

## Tahap 2 — Pemain baru dan kenyamanan

- [x] Tutorial 6 langkah yang bisa dilewati: gerak, lompat, smash, smash sempurna, terima, jurus
- [ ] Layar "Cara main" dan daftar gerakan per karakter
- [x] Menu utama dikelompokkan: Main, Online, Latihan, Pengaturan
- [x] Layar Pengaturan: volume, kualitas grafis, ukuran tombol layar, getaran. Belum: posisi tombol
- [ ] Ubah tombol keyboard dan stick
- [x] Kurangi kilatan dan guncangan. Belum: teks lebih besar, mode buta warna
- [x] Bisa dipasang ke layar utama HP dan dimainkan tanpa internet (PWA)
- [x] Ikon aplikasi, gambar pratinjau link, judul tab tanpa "prototipe"
- [ ] Layar pemuatan dan transisi antar layar
- [ ] Bahasa Inggris sebagai pilihan kedua

Selesai kalau: orang yang belum pernah main bisa menang satu poin lawan CPU Mudah
tanpa dijelaskan siapa pun.

## Tahap 3 — Keseimbangan dan aturan

- [ ] Alat ukur otomatis: liga CPU lawan CPU yang bisa dijalankan dari terminal
- [ ] Rapatkan tingkat menang karakter ke 45–55%
- [ ] Setel angka penonton usil dari hasil uji bertiga
- [ ] Servis bergantian dan posisi servis seperti takraw asli
- [ ] Pilihan panjang pertandingan: poin per set dan jumlah set
- [ ] CPU dengan gaya main per karakter, dan tingkat keempat "Jagoan"

Selesai kalau: liga 500 pertandingan per pasangan menunjukkan tidak ada karakter di
luar 45–55%.

## Tahap 4 — Mode tim

Inti game sekarang dikunci untuk dua pemain. Tahap ini merombaknya jadi N pemain per sisi.

- [ ] Simulasi mendukung 1–3 pemain per sisi, 3 sentuhan dibagi satu tim
- [ ] 2v2 dengan CPU sebagai teman setim
- [ ] 3v3 dengan peran takraw: tekong (servis), feeder (umpan), striker (smash)
- [ ] Umpan ke teman: bola diangkat ke arah teman terdekat
- [ ] Kamera, HUD, dan layar pilih jagoan untuk 4–6 pemain
- [ ] Kursi online sampai 6 pemain plus penonton
- [ ] Jurus gabungan dua karakter

Selesai kalau: 2v2 dan 3v3 bisa dimainkan lokal dan online, kursi kosong diisi CPU.

## Tahap 5 — Online yang layak

- [ ] Rapikan `main.ts`: pisahkan menu, HUD, jaringan, dan loop game ke berkas sendiri
- [ ] Penghalus gerakan di tamu, dan prediksi gerakan untuk pemain tamu sendiri
- [ ] Game tetap jalan saat tab host disembunyikan (simulasi pindah ke worker)
- [ ] Sambung ulang otomatis untuk tamu, dan pemindahan host kalau host putus
- [ ] Server perantara sendiri, supaya tidak bergantung pada layanan gratis
- [ ] Nama pemain, emote cepat, penunjuk kualitas sambungan
- [ ] Kunci room dan tombol keluarkan tamu
- [ ] Daftar room dan "cari lawan" otomatis
- [ ] Lawan CPU bisa dipakai di room online

Selesai kalau: dua orang di kota berbeda bisa main 10 pertandingan berturut-turut
tanpa putus, dan pemain tanpa teman bisa dapat lawan dalam satu menit.

Keputusan yang dibutuhkan sebelum mulai: server sendiri berarti ada biaya bulanan.

## Tahap 6 — Isi dan alasan untuk kembali

- [ ] Arena baru: pantai, pasar malam, lapangan sekolah; variasi siang, sore, malam
- [ ] Karakter baru sampai 12, tiap karakter punya jenis jurus sendiri
- [ ] Animasi masuk lapangan, menang, dan kalah per karakter
- [ ] Mode arcade (lawan CPU berurutan) dan turnamen 4–8 pemain
- [ ] Tantangan harian
- [ ] Senjata penonton baru, dan lebih dari satu penonton usil
- [ ] Tayangan ulang poin terakhir dan cuplikan momen terbaik
- [ ] Profil pemain, statistik, dan pencapaian
- [ ] Kostum dan karakter yang dibuka dengan bermain
- [ ] Peringkat dan papan skor
- [ ] Bagikan hasil pertandingan sebagai gambar

Selesai kalau: ada alasan jelas untuk main lagi besok, bukan hanya hari ini.

Keputusan yang dibutuhkan: profil dan peringkat butuh akun dan basis data.

## Tahap 7 — Rilis ke publik

- [ ] Tes otomatis untuk simulasi dan aturan
- [ ] Laporan error dari pemain dan data pemakaian dasar
- [ ] Ukur dan perbaiki performa di HP kelas bawah; pecah unduhan awal
- [ ] Domain sendiri
- [ ] Kebijakan privasi, ketentuan pakai, dan lisensi repo
- [ ] Tombol lapor bug dan masukan
- [ ] README dan dokumentasi cara kerja
- [ ] Halaman perkenalan dan trailer
- [ ] Rencana biaya server dan rencana pemasukan

Selesai kalau: orang asing bisa menemukan, memainkan, dan melaporkan masalah tanpa
menghubungi pembuatnya.

## Yang sengaja tidak dikerjakan

- Meniru karakter, UI, atau aset game lain
- Karakter humanoid atau anime (sudah dicoba dan ditolak; arahnya maskot jajanan)
