import { createSupabaseAdminClient } from "@/lib/serverAuth";
import { ASSET_BUCKET, UNASSIGNED_SCOPE, getAssetPathFromUrl } from "@/lib/storageConfig";

/**
 * Helper Storage khusus server (memakai service_role).
 * JANGAN impor file ini dari komponen client — bergantung pada next/headers
 * via serverAuth sehingga build client akan gagal jika diimpor.
 */

/** Hapus aset berdasarkan daftar URL. URL eksternal / bukan milik bucket diabaikan. */
export async function removeAssetsByUrl(urls: (string | null | undefined)[]): Promise<void> {
  const paths = Array.from(
    new Set(urls.map((u) => getAssetPathFromUrl(u)).filter((p): p is string => Boolean(p)))
  );
  if (paths.length === 0) return;
  const sb = createSupabaseAdminClient();
  const { error } = await sb.storage.from(ASSET_BUCKET).remove(paths);
  if (error) console.error("[storage] gagal menghapus aset:", error.message);
}

/** Hapus seluruh aset milik satu tenant (dipakai saat tenant dihapus). */
export async function removeTenantAssets(tenantId: string): Promise<void> {
  const sb = createSupabaseAdminClient();
  const bucket = sb.storage.from(ASSET_BUCKET);
  const folders = ["logos", "products", "categories", "qris"];

  for (const folder of folders) {
    const prefix = `${tenantId}/${folder}`;
    // list() maksimal 1000 item per panggilan → ulangi sampai kosong
    for (let guard = 0; guard < 50; guard++) {
      const { data, error } = await bucket.list(prefix, { limit: 1000 });
      if (error || !data || data.length === 0) break;
      const paths = data.filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
      if (paths.length === 0) break;
      const { error: rmErr } = await bucket.remove(paths);
      if (rmErr) {
        console.error("[storage] gagal hapus folder tenant:", rmErr.message);
        break;
      }
    }
  }
}

/**
 * Pindahkan aset dari folder `_unassigned/` ke folder tenant yang baru dibuat.
 * Mengembalikan Public URL baru, atau URL asli jika tidak perlu/gagal dipindah.
 */
export async function relocateUnassignedAsset(
  url: string | null | undefined,
  tenantId: string
): Promise<string | null> {
  if (!url) return null;
  const path = getAssetPathFromUrl(url);
  if (!path || !path.startsWith(`${UNASSIGNED_SCOPE}/`)) return url;

  const newPath = `${tenantId}/${path.slice(UNASSIGNED_SCOPE.length + 1)}`;
  const sb = createSupabaseAdminClient();
  const bucket = sb.storage.from(ASSET_BUCKET);
  const { error } = await bucket.move(path, newPath);
  if (error) {
    console.error("[storage] gagal memindahkan aset:", error.message);
    return url;
  }
  return bucket.getPublicUrl(newPath).data.publicUrl;
}
