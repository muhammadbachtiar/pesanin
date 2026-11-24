/**
 * Pesanin PWA Service Worker (public/sw.js)
 *
 * Strategi Caching:
 * 1. BYPASS (Network-Only): Semua request non-GET, /api/*, dan *.supabase.co
 *    tidak pernah disimpan di cache agar transaksi pesanan, stok realtime, dan auth selalu live.
 * 2. STALE-WHILE-REVALIDATE: Aset statis Next.js (/_next/static/*), font, dan
 *    gambar menu dari Supabase Storage (/storage/v1/object/public/tenant-assets/*)
 *    disimpan di cache agar Kiosk & Kasir memuat foto menu secara instan.
 * 3. NETWORK-FIRST + OFFLINE FALLBACK: Navigasi halaman HTML mencoba jaringan dulu,
 *    dan bila Wi-Fi kafe terputus akan menampilkan layar pemulihan `/offline`.
 */

const CACHE_VERSION = "pesanin-pwa-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== IMAGE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 1. Abaikan semua method selain GET
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 2. Jangan pernah cache endpoint API internal atau Supabase REST/Auth/Realtime
  const isManagedStorageImage = url.pathname.includes("/storage/v1/object/public/tenant-assets/");
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/data/") ||
    (url.hostname.includes("supabase.co") && !isManagedStorageImage)
  ) {
    return;
  }

  // 3. Gambar menu (Supabase Storage tenant-assets) & aset statis Next.js -> Stale-While-Revalidate
  if (
    isManagedStorageImage ||
    url.pathname.startsWith("/_next/static/") ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    const targetCacheName = isManagedStorageImage || request.destination === "image" ? IMAGE_CACHE : STATIC_CACHE;
    event.respondWith(
      caches.open(targetCacheName).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  // 4. Navigasi halaman HTML -> Network-First dengan fallback ke /offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const offlineFallback = await cache.match(OFFLINE_URL);
        return (
          offlineFallback ||
          new Response(
            "<!DOCTYPE html><html lang='id'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Koneksi Terputus</title></head><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#09090b;color:#fff;text-align:center;padding:24px'><div><h2>📡 Koneksi Internet Terputus</h2><p style='color:#94a3b8'>Periksa Wi-Fi outlet Anda. Halaman akan memuat ulang otomatis saat internet kembali.</p><button onclick='location.reload()' style='margin-top:16px;padding:12px 24px;border-radius:12px;border:none;background:#4f46e5;color:#fff;font-weight:bold;cursor:pointer'>Coba Lagi</button></div></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          )
        );
      })
    );
  }
});
