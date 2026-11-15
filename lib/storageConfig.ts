/**
 * Konfigurasi aset Storage yang aman dipakai di client maupun server.
 * Sinkron dengan: supabase/migrations/20261108220000_storage_tenant_assets.sql
 */

export const ASSET_BUCKET = "tenant-assets";

/** Folder yang diizinkan di dalam `{tenantId}/` */
export const ASSET_FOLDERS = ["logos", "products", "categories", "qris"] as const;
export type AssetFolder = (typeof ASSET_FOLDERS)[number];

/** Folder sementara untuk logo tenant baru yang belum memiliki ID */
export const UNASSIGNED_SCOPE = "_unassigned";

/** Batas ukuran file SETELAH kompresi klien (harus sama dengan file_size_limit bucket) */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Batas ukuran file mentah yang boleh dipilih user sebelum kompresi */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME = ["image/webp", "image/jpeg", "image/png"] as const;

const PUBLIC_PREFIX = `/storage/v1/object/public/${ASSET_BUCKET}/`;

/**
 * Ambil object path dari Public URL Supabase milik bucket kita.
 * Mengembalikan null jika URL bukan aset bucket ini (mis. link eksternal).
 */
export function getAssetPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (base && parsed.origin !== new URL(base).origin) return null;
    const idx = parsed.pathname.indexOf(PUBLIC_PREFIX);
    if (idx === -1) return null;
    const path = decodeURIComponent(parsed.pathname.slice(idx + PUBLIC_PREFIX.length));
    // Tolak path traversal / path kosong
    if (!path || path.includes("..") || path.startsWith("/")) return null;
    return path;
  } catch {
    return null;
  }
}

/** True jika URL adalah aset yang dikelola bucket ini (bukan link eksternal). */
export function isManagedAssetUrl(url: string | null | undefined): boolean {
  return getAssetPathFromUrl(url) !== null;
}

