/**
 * Utilitas Standar Startup untuk Proteksi Double-Submit, Synchronous Lock,
 * dan Request Deduplication / Idempotency saat sinyal tidak stabil.
 */

const inFlightRequests = new Map<string, Promise<unknown>>();
const completedIdempotencyCache = new Map<
  string,
  { result: unknown; expiresAt: number }
>();

/** Bersihkan cache idempotensi yang sudah lewat masa berlaku */
function pruneCompletedCache() {
  const now = Date.now();
  for (const [key, entry] of completedIdempotencyCache.entries()) {
    if (entry.expiresAt <= now) {
      completedIdempotencyCache.delete(key);
    }
  }
}

/**
 * Buat kunci idempotensi unik untuk satu sesi form / checkout.
 * Kunci ini tetap sama selama retry pada sesi form yang sama, dan di-reset
 * hanya setelah transaksi berhasil atau keranjang/form dikosongkan.
 */
export function generateIdempotencyKey(prefix = "idem"): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

/**
 * Deduplikasi eksekusi async yang sedang berjalan (in-flight) berdasarkan `key`.
 * - Jika ada fungsi dengan `key` yang sama sedang berjalan (mis. user klik 2x saat sinyal lambat),
 *   panggilan kedua TIDAK akan menembak request baru ke server, melainkan menunggu Promise pertama.
 * - Jika `ttlMs > 0`, hasil sukses akan disimpan selama `ttlMs` milidetik untuk menahan retry duplikat
 *   dengan idempotency key yang sama.
 */
export async function dedupeInFlight<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 0
): Promise<T> {
  pruneCompletedCache();

  if (ttlMs > 0) {
    const cached = completedIdempotencyCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result as T;
    }
  }

  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    try {
      const result = await fn();
      if (ttlMs > 0 && result !== null && result !== false) {
        completedIdempotencyCache.set(key, {
          result,
          expiresAt: Date.now() + ttlMs,
        });
      }
      return result;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, promise);
  return promise;
}
