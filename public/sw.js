// Menyimpan game di perangkat supaya bisa dibuka tanpa internet setelah kunjungan pertama.
// Mabar online tetap butuh internet.
const CACHE = "takraw-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const put = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  // Halaman: ambil yang terbaru dulu supaya pembaruan langsung terasa; tanpa internet pakai simpanan.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(put)
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  // File bernama unik per versi (assets/): simpanan selalu benar.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
    return;
  }

  // Lainnya (suara, ikon): pakai simpanan supaya cepat, sambil memperbarui di belakang.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then(put);
      return hit || fresh;
    }),
  );
});
