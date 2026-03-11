-- ============================================================
-- RLS PATCH — Pesanin App
-- Jalankan di Supabase SQL Editor setelah schema.sql
-- ============================================================

-- 1. Super Admin: akses penuh ke semua tabel operasional
--    (schema awal hanya punya sa_all_tenants dan sa_all_profiles)

DROP POLICY IF EXISTS "sa_all_categories"          ON categories;
DROP POLICY IF EXISTS "sa_all_products"            ON products;
DROP POLICY IF EXISTS "sa_all_pvg"                 ON product_variant_groups;
DROP POLICY IF EXISTS "sa_all_pvo"                 ON product_variant_options;
DROP POLICY IF EXISTS "sa_all_tables"              ON tables;
DROP POLICY IF EXISTS "sa_all_orders"              ON orders;
DROP POLICY IF EXISTS "sa_all_order_items"         ON order_items;
DROP POLICY IF EXISTS "anon_read_active_tenants"   ON tenants;

-- Categories
CREATE POLICY "sa_all_categories"
  ON categories FOR ALL TO authenticated
  USING (is_super_admin());

-- Products
CREATE POLICY "sa_all_products"
  ON products FOR ALL TO authenticated
  USING (is_super_admin());

-- Product Variant Groups
CREATE POLICY "sa_all_pvg"
  ON product_variant_groups FOR ALL TO authenticated
  USING (is_super_admin());

-- Product Variant Options
CREATE POLICY "sa_all_pvo"
  ON product_variant_options FOR ALL TO authenticated
  USING (is_super_admin());

-- Tables (meja)
CREATE POLICY "sa_all_tables"
  ON tables FOR ALL TO authenticated
  USING (is_super_admin());

-- Orders
CREATE POLICY "sa_all_orders"
  ON orders FOR ALL TO authenticated
  USING (is_super_admin());

-- Order Items
CREATE POLICY "sa_all_order_items"
  ON order_items FOR ALL TO authenticated
  USING (is_super_admin());

-- 2. Anon bisa baca tenant aktif
--    (diperlukan untuk layout server saat user belum login / kiosk publik)
CREATE POLICY "anon_read_active_tenants"
  ON tenants FOR SELECT TO anon
  USING (is_active = TRUE);

-- ============================================================
-- Verifikasi: cek semua policy yang aktif
-- ============================================================
-- SELECT tablename, policyname, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
