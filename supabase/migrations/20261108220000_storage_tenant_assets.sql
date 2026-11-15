-- ============================================================================
-- PATCH 9 — Supabase Storage: bucket "tenant-assets"
-- ----------------------------------------------------------------------------
-- Tujuan  : Menyimpan aset gambar per-outlet (logo, foto menu, ikon kategori,
--           gambar QRIS statis) yang diunggah dari Super Admin & Admin Outlet.
-- Dibuat  : 2026-11-08
-- Idempoten: AMAN dijalankan berulang kali.
--
-- Struktur path objek:
--   tenant-assets/
--     {tenant_id}/logos/{timestamp}-{rand}.webp
--     {tenant_id}/products/{timestamp}-{rand}.webp
--     {tenant_id}/categories/{timestamp}-{rand}.webp
--     {tenant_id}/qris/{timestamp}-{rand}.webp
--     _unassigned/logos/...   -> logo tenant baru yang belum punya ID
--                                (otomatis dipindah ke folder tenant saat dibuat)
--
-- Model keamanan:
--   * Bucket PUBLIC  -> gambar bisa dibaca lewat Public URL tanpa login
--                       (dibutuhkan Kiosk publik & struk).
--   * TIDAK ADA policy INSERT/UPDATE/DELETE untuk anon/authenticated.
--     Semua penulisan WAJIB lewat API route Next.js `/api/upload` yang:
--       - memverifikasi sesi & role (OWNER / SUPER_ADMIN),
--       - memastikan Owner hanya menulis ke folder tenant miliknya,
--       - memvalidasi MIME + magic bytes + ukuran,
--     lalu mengunggah memakai SUPABASE_SERVICE_ROLE_KEY (bypass RLS).
--   * TIDAK ADA policy SELECT pada storage.objects -> isi bucket tidak bisa
--     di-listing/dienumerasi via API publik. Public URL tetap berfungsi
--     karena bucket bertipe public.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-assets',
  'tenant-assets',
  TRUE,
  2097152,                                           -- 2 MB (setelah kompresi klien)
  ARRAY['image/webp', 'image/jpeg', 'image/png']     -- SVG sengaja ditolak (risiko XSS)
)
ON CONFLICT (id) DO UPDATE
SET public             = EXCLUDED.public,
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Verifikasi ──────────────────────────────────────────────────────────────
-- SELECT id, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'tenant-assets';
--
-- Harus TIDAK ada policy tulis untuk bucket ini:
-- SELECT policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects';

