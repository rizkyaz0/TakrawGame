# Takraw Clash

Game sepak takraw arcade di browser (Vite, TypeScript, Three.js). Situs live:
https://takraw-clash.vercel.app. Push ke `main` langsung ter-deploy.

## Baca dulu

- `README.md`: susunan kode dan perintah.
- `ROADMAP.md`: apa yang sudah dan belum dikerjakan.
- `docs/REDESIGN_PLAN.md`: pekerjaan berikutnya, tahap demi tahap, dengan gambar acuan di `docs/design/`.

## Aturan

- Bahasa Indonesia santai; jawaban langsung, ringkas, dan jujur soal apa yang belum diuji.
- Commit dan push hanya kalau pemilik meminta.
- Jangan membaca atau mencetak `.env.local`.
- `src/sim.ts` harus tetap murni dan deterministik: tanpa DOM, tanpa `Math.random`.
- Karakter adalah maskot jajanan buatan kode; jangan diganti model unduhan atau bentuk manusia.
- Sebelum melapor selesai: `npx tsc --noEmit`, `npm run build`, `npm test`.
- Perubahan aturan main atau jurus: ukur dengan `npm run league -- 20 1` dan `-- 20 2`.
