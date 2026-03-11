-- ============================================================
-- PESANIN APP — Supabase PostgreSQL Schema (Rev 3 — Final)
-- Changes from Rev 2:
--   - payment_method_type: gateway|manual|cash → gateway|qris_static|bank_transfer|cash
--     (records the specific channel used in orders, not just the mode)
--   - business_logic.payment_mode: "gateway" | "manual" (cash is a channel inside manual)
--   - orders: added created_by_cashier + cashier_profile_id (for manual cashier orders)
--   - manual_payment_channels: cash added as a valid channel type
-- ============================================================

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'OWNER', 'CASHIER', 'KITCHEN');

CREATE TYPE payment_timing_type AS ENUM ('prepaid', 'postpaid');

-- payment_mode di tenants: hanya 2 pilihan (cash adalah channel di dalam manual)
CREATE TYPE payment_mode_type AS ENUM ('gateway', 'manual');

CREATE TYPE payment_gateway_provider AS ENUM ('midtrans', 'xendit');

-- payment_method di orders: channel spesifik yang digunakan pelanggan/kasir
CREATE TYPE payment_method_type AS ENUM ('gateway', 'qris_static', 'bank_transfer', 'cash');

CREATE TYPE numbering_type AS ENUM ('queue', 'table');

CREATE TYPE table_status AS ENUM ('available', 'occupied', 'broken');

CREATE TYPE order_status AS ENUM ('pending', 'cooking', 'ready', 'completed', 'cancelled');

CREATE TYPE payment_status AS ENUM ('unpaid', 'paid', 'refunded');

-- unverified = belum di-review kasir
-- verified   = kasir setujui (postpaid atau manual prepaid)
-- rejected   = kasir tolak (pembatalan)
CREATE TYPE verification_status AS ENUM ('unverified', 'verified', 'rejected');

CREATE TYPE order_type AS ENUM ('dine_in', 'takeaway');

-- ============================================================
-- 2. TENANTS
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identitas & Branding
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    subtitle        TEXT,
    description     TEXT,
    logo_url        TEXT,

    -- Visual Config (injected sebagai CSS variables)
    visual_config   JSONB NOT NULL DEFAULT '{
        "primary_color": "#6366f1",
        "secondary_color": "#a5b4fc"
    }'::JSONB,

    -- Business Logic (saklar perilaku utama)
    business_logic  JSONB NOT NULL DEFAULT '{
        "payment_timing": "prepaid",
        "payment_mode": "manual",
        "numbering": "queue",
        "require_cashier_verification": false
    }'::JSONB,
    -- payment_timing: "prepaid" | "postpaid"
    -- payment_mode  : "gateway" | "manual"
    --                 → jika "manual", cash adalah salah satu opsi di manual_payment_channels
    -- numbering     : "queue" | "table"
    --                 → queue_number SELALU digenerate, setting ini hanya mengatur apakah
    --                   nomor meja juga wajib diisi
    -- require_cashier_verification: true | false (hanya relevan untuk postpaid)

    -- Gateway Config (aktif jika payment_mode = 'gateway')
    payment_gateway_config JSONB DEFAULT '{}'::JSONB,
    -- { "provider": "midtrans", "server_key": "SB-Mid-...", "client_key": "SB-Mid-..." }

    -- Manual Payment Channels (aktif jika payment_mode = 'manual')
    -- Array fleksibel: QRIS, bank transfer, cash — owner bisa atur sendiri
    manual_payment_channels JSONB DEFAULT '[]'::JSONB,
    -- [
    --   {
    --     "id": "ch-001",
    --     "type": "qris_static",
    --     "label": "QRIS / E-Wallet",
    --     "image_url": "https://...",
    --     "instructions": "Scan QR lalu tunjukkan bukti ke kasir"
    --   },
    --   {
    --     "id": "ch-002",
    --     "type": "bank_transfer",
    --     "label": "Transfer BCA",
    --     "bank_name": "BCA",
    --     "account_number": "1234567890",
    --     "account_name": "Nama Pemilik",
    --     "instructions": "Transfer lalu tunjukkan bukti ke kasir"
    --   },
    --   {
    --     "id": "ch-003",
    --     "type": "cash",
    --     "label": "Tunai / Cash",
    --     "instructions": "Bayar langsung ke kasir dengan menunjukkan nomor pesanan Anda"
    --   }
    -- ]

    -- Finance Config
    finance_config  JSONB NOT NULL DEFAULT '{
        "tax_percentage": 0,
        "service_charge_percentage": 0,
        "takeaway_fee": 0
    }'::JSONB,

    -- Receipt / Struk Config
    receipt_config  JSONB NOT NULL DEFAULT '{
        "header_text": "",
        "footer_text": "Terima kasih atas kunjungan Anda!",
        "show_logo": true
    }'::JSONB,

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS 'Induk semua tenant/kafe. Konfigurasi perilaku seluruh display tersimpan di sini.';
COMMENT ON COLUMN tenants.business_logic IS
    'payment_timing: prepaid|postpaid. payment_mode: gateway|manual (cash ada di dalam manual).
     numbering: queue|table. Queue SELALU digenerate.';
COMMENT ON COLUMN tenants.manual_payment_channels IS
    'Array channel manual yang dikustomisasi owner. Jenis: qris_static, bank_transfer, cash.
     Cash adalah channel dalam manual, bukan mode terpisah.';

-- ============================================================
-- 3. PROFILES
-- ============================================================

CREATE TABLE profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = SUPER_ADMIN

    full_name       TEXT,
    role            user_role NOT NULL DEFAULT 'CASHIER',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, tenant_id)
);

COMMENT ON COLUMN profiles.tenant_id IS 'NULL untuk SUPER_ADMIN. Staff terkunci ke 1 tenant.';

-- ============================================================
-- 4. TABLES (Meja & QR Token)
-- ============================================================

CREATE TABLE tables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    table_number    TEXT NOT NULL,
    display_name    TEXT,

    -- Token disisipkan ke URL QR: /{slug}/kiosk?table=01&token=<current_token>
    current_token   TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),

    status          table_status NOT NULL DEFAULT 'available',
    last_token_reset TIMESTAMPTZ DEFAULT NOW(),

    position_x      INTEGER,
    position_y      INTEGER,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, table_number)
);

-- ============================================================
-- 5. CATEGORIES
-- ============================================================

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,
    description     TEXT,
    image_url       TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(tenant_id, name)
);

-- ============================================================
-- 6. PRODUCTS
-- ============================================================

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,

    name            TEXT NOT NULL,
    description     TEXT,
    base_price      NUMERIC(12, 2) NOT NULL DEFAULT 0,
    image_urls      TEXT[] DEFAULT ARRAY[]::TEXT[],   -- index 0 = gambar utama

    is_available    BOOLEAN NOT NULL DEFAULT TRUE,    -- toggle kasir (realtime)
    stock_count     INTEGER,                          -- NULL = tanpa batas

    labels          TEXT[] DEFAULT ARRAY[]::TEXT[],   -- 'best_seller', 'new', 'spicy', dll
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_featured     BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN products.is_featured IS 'true = tampil paling atas section, sort_order diabaikan.';
COMMENT ON COLUMN products.stock_count IS 'NULL = tanpa batas. 0 = habis (auto set is_available=false via trigger opsional).';

-- ============================================================
-- 7. PRODUCT VARIANTS
-- ============================================================

CREATE TABLE product_variant_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,            -- "Ukuran", "Level Manis", "Topping"
    is_required     BOOLEAN NOT NULL DEFAULT FALSE,
    max_selections  INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_variant_options (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES product_variant_groups(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,
    additional_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. ORDERS (Transaction Header)
-- ============================================================

CREATE TABLE orders (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Identifiers
    -- queue_number: SELALU ada, format "001"–"999", reset harian per tenant (WIB)
    -- Jika numbering=table → meja menonjol di UI, queue tetap tercetak kecil di struk
    queue_number                TEXT NOT NULL,
    table_number                TEXT,
    table_id                    UUID REFERENCES tables(id) ON DELETE SET NULL,
    order_type                  order_type NOT NULL DEFAULT 'dine_in',

    -- Status Pipeline
    order_status                order_status NOT NULL DEFAULT 'pending',
    payment_status              payment_status NOT NULL DEFAULT 'unpaid',
    verification_status         verification_status NOT NULL DEFAULT 'unverified',

    -- Financial (snapshot saat checkout)
    subtotal                    NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount                  NUMERIC(12, 2) NOT NULL DEFAULT 0,
    service_charge_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    takeaway_fee_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount                NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Payment Detail
    -- payment_method: channel spesifik — gateway | qris_static | bank_transfer | cash
    -- Diisi saat pelanggan/kasir memilih channel, bukan saat order dibuat
    payment_method              payment_method_type,
    selected_manual_channel_id  TEXT,   -- id dari manual_payment_channels JSONB di tenants

    -- Gateway Info
    gateway_transaction_id      TEXT,
    gateway_status              TEXT,

    -- Audit & Tracking
    customer_notes              TEXT,

    -- Verifikasi kasir
    verified_by                 UUID REFERENCES profiles(id) ON DELETE SET NULL,
    verified_at                 TIMESTAMPTZ,

    -- Void / Edit
    void_reason                 TEXT,
    voided_by                   UUID REFERENCES profiles(id) ON DELETE SET NULL,
    voided_at                   TIMESTAMPTZ,

    -- Flag: order dibuat langsung oleh kasir (bukan dari kiosk/QR pelanggan)
    created_by_cashier          BOOLEAN NOT NULL DEFAULT FALSE,
    cashier_profile_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
    -- Jika created_by_cashier=true, cashier_profile_id diisi

    -- Snapshot konfigurasi finance saat order (laporan historis tidak berubah)
    finance_snapshot            JSONB DEFAULT '{}'::JSONB,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN orders.queue_number IS
    'SELALU diisi. Format 001–999, reset harian per tenant (WIB).
     numbering=queue: menonjol. numbering=table: kecil di struk.';
COMMENT ON COLUMN orders.payment_method IS
    'Channel spesifik: gateway | qris_static | bank_transfer | cash.
     Diisi saat checkout (bukan saat order dibuat).';
COMMENT ON COLUMN orders.created_by_cashier IS
    'TRUE jika order dibuat langsung oleh kasir (pelanggan walk-in tidak pakai kiosk).';

-- ============================================================
-- 9. ORDER ITEMS (Transaction Detail)
-- ============================================================

CREATE TABLE order_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id              UUID REFERENCES products(id) ON DELETE SET NULL,

    -- Snapshot (laporan historis akurat meski produk/harga berubah)
    product_name_snapshot   TEXT NOT NULL,
    base_price_snapshot     NUMERIC(12, 2) NOT NULL,

    -- Varian yang dipilih (snapshot)
    selected_variants       JSONB DEFAULT '[]'::JSONB,
    -- [{ "group": "Ukuran", "option": "Large", "additional_price": 5000 }, ...]

    quantity                INTEGER NOT NULL DEFAULT 1,
    unit_price              NUMERIC(12, 2) NOT NULL,   -- base + sum(additional_prices varian)
    subtotal                NUMERIC(12, 2) NOT NULL,   -- unit_price * quantity

    notes                   TEXT,    -- "Tanpa gula", "Ice dikit", "Extra pedas"

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. INDEXES
-- ============================================================

CREATE INDEX idx_tenants_slug             ON tenants(slug);
CREATE INDEX idx_tenants_active           ON tenants(is_active);

CREATE INDEX idx_profiles_user            ON profiles(user_id);
CREATE INDEX idx_profiles_tenant          ON profiles(tenant_id);
CREATE INDEX idx_profiles_role            ON profiles(role);

CREATE INDEX idx_tables_tenant            ON tables(tenant_id);
CREATE INDEX idx_tables_status            ON tables(status);

CREATE INDEX idx_categories_tenant_sort   ON categories(tenant_id, sort_order);
CREATE INDEX idx_products_featured_sort   ON products(tenant_id, is_featured, sort_order);
CREATE INDEX idx_products_available       ON products(tenant_id, is_available);
CREATE INDEX idx_products_category        ON products(category_id);

CREATE INDEX idx_pvg_product              ON product_variant_groups(product_id);
CREATE INDEX idx_pvo_group                ON product_variant_options(group_id);

-- Orders — kritis untuk query realtime Kasir & Dapur
CREATE INDEX idx_orders_tenant_status     ON orders(tenant_id, order_status);
CREATE INDEX idx_orders_tenant_pay        ON orders(tenant_id, payment_status);
CREATE INDEX idx_orders_tenant_verify     ON orders(tenant_id, verification_status);
CREATE INDEX idx_orders_tenant_created    ON orders(tenant_id, created_at DESC);
CREATE INDEX idx_orders_cashier_flag      ON orders(tenant_id, created_by_cashier);

CREATE INDEX idx_order_items_order        ON order_items(order_id);
CREATE INDEX idx_order_items_product      ON order_items(product_id);

-- ============================================================
-- 11. TRIGGERS — Auto updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_upd    BEFORE UPDATE ON tenants    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_profiles_upd   BEFORE UPDATE ON profiles   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_tables_upd     BEFORE UPDATE ON tables     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_categories_upd BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_products_upd   BEFORE UPDATE ON products   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_orders_upd     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 12. HELPER FUNCTIONS
-- ============================================================

-- Queue number: "001"–"999", reset harian per tenant (WIB)
CREATE OR REPLACE FUNCTION generate_queue_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE v_count INTEGER;
BEGIN
    SELECT COUNT(*) + 1 INTO v_count
    FROM orders
    WHERE tenant_id = p_tenant_id
      AND DATE(created_at AT TIME ZONE 'Asia/Jakarta') = DATE(NOW() AT TIME ZONE 'Asia/Jakarta')
      AND order_status != 'cancelled';
    RETURN LPAD(v_count::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_queue_number IS
    'Nomor antrian 3-digit, reset harian per tenant (WIB). SELALU dipanggil saat INSERT order.';

-- Rotasi token QR meja
CREATE OR REPLACE FUNCTION rotate_table_token(p_table_id UUID)
RETURNS TEXT AS $$
DECLARE v_token TEXT;
BEGIN
    v_token := encode(gen_random_bytes(16), 'hex');
    UPDATE tables SET current_token = v_token, last_token_reset = NOW(), status = 'available'
    WHERE id = p_table_id;
    RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Hitung total pesanan (dipanggil di application layer)
CREATE OR REPLACE FUNCTION calculate_order_total(
    p_subtotal NUMERIC, p_tax_pct NUMERIC,
    p_service_pct NUMERIC, p_takeaway_fee NUMERIC, p_order_type order_type
)
RETURNS TABLE(tax_amount NUMERIC, service_charge_amount NUMERIC,
              takeaway_fee_amount NUMERIC, total_amount NUMERIC) AS $$
DECLARE v_tax NUMERIC; v_svc NUMERIC; v_tkwy NUMERIC;
BEGIN
    v_tax  := ROUND(p_subtotal * p_tax_pct / 100, 2);
    v_svc  := ROUND(p_subtotal * p_service_pct / 100, 2);
    v_tkwy := CASE WHEN p_order_type = 'takeaway' THEN p_takeaway_fee ELSE 0 END;
    RETURN QUERY SELECT v_tax, v_svc, v_tkwy, p_subtotal + v_tax + v_svc + v_tkwy;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 13. ROW LEVEL SECURITY
-- Isolasi ketat: staff hanya bisa akses data tenant sendiri.
-- ============================================================

ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items            ENABLE ROW LEVEL SECURITY;

-- Helper functions (dipanggil di within policy USING clause)
CREATE OR REPLACE FUNCTION auth_tenant_id()
RETURNS UUID AS $$
    SELECT tenant_id FROM profiles WHERE user_id = auth.uid() AND is_active = TRUE LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS user_role AS $$
    SELECT role FROM profiles WHERE user_id = auth.uid() AND is_active = TRUE LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN' AND is_active = TRUE);
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- TENANTS
CREATE POLICY "sa_all_tenants"          ON tenants FOR ALL TO authenticated USING (is_super_admin());
CREATE POLICY "staff_own_tenant"        ON tenants FOR SELECT TO authenticated USING (id = auth_tenant_id());

-- PROFILES
CREATE POLICY "sa_all_profiles"         ON profiles FOR ALL TO authenticated USING (is_super_admin());
CREATE POLICY "owner_manage_profiles"   ON profiles FOR ALL TO authenticated
    USING (auth_user_role() = 'OWNER' AND tenant_id = auth_tenant_id());
CREATE POLICY "self_read_profile"       ON profiles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- TABLES
CREATE POLICY "staff_own_tables"        ON tables FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());
CREATE POLICY "anon_read_tables"        ON tables FOR SELECT TO anon USING (TRUE);

-- CATEGORIES
CREATE POLICY "staff_own_categories"    ON categories FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());
CREATE POLICY "anon_read_categories"    ON categories FOR SELECT TO anon USING (is_active = TRUE);

-- PRODUCTS
CREATE POLICY "staff_own_products"      ON products FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());
CREATE POLICY "anon_read_products"      ON products FOR SELECT TO anon USING (is_available = TRUE);

-- PRODUCT VARIANT GROUPS
CREATE POLICY "staff_own_pvg"           ON product_variant_groups FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());
CREATE POLICY "anon_read_pvg"           ON product_variant_groups FOR SELECT TO anon USING (TRUE);

-- PRODUCT VARIANT OPTIONS
CREATE POLICY "staff_own_pvo"           ON product_variant_options FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());
CREATE POLICY "anon_read_pvo"           ON product_variant_options FOR SELECT TO anon USING (is_available = TRUE);

-- ORDERS
CREATE POLICY "anon_insert_orders"      ON orders FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_read_orders"        ON orders FOR SELECT TO anon USING (TRUE);
CREATE POLICY "staff_own_orders"        ON orders FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());

-- ORDER ITEMS
CREATE POLICY "anon_insert_items"       ON order_items FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_read_items"         ON order_items FOR SELECT TO anon USING (TRUE);
CREATE POLICY "staff_own_items"         ON order_items FOR ALL TO authenticated USING (tenant_id = auth_tenant_id());

-- ============================================================
-- 14. REALTIME PUBLICATION
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE tables;

-- ============================================================
-- 15. SEED DATA — 1 Tenant Demo
-- ============================================================

INSERT INTO tenants (
    id, name, slug, subtitle, description, logo_url,
    visual_config, business_logic, finance_config,
    payment_gateway_config, manual_payment_channels, receipt_config
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Kafe Pesanin Demo', 'kafe-demo',
    'Kopi enak, harga bersahabat ☕',
    'Kafe cozy di tengah kota dengan berbagai pilihan kopi dan makanan ringan.',
    'https://placehold.co/200x200/6366f1/white?text=KP',
    '{"primary_color": "#6366f1", "secondary_color": "#a5b4fc"}',
    '{
        "payment_timing": "prepaid",
        "payment_mode": "manual",
        "numbering": "queue",
        "require_cashier_verification": true
    }',
    '{"tax_percentage": 11, "service_charge_percentage": 5, "takeaway_fee": 2000}',
    '{}',
    '[
        {
            "id": "ch-001", "type": "qris_static",
            "label": "QRIS / E-Wallet",
            "image_url": "https://placehold.co/300x300/6366f1/white?text=QRIS",
            "instructions": "Scan QR lalu tunjukkan bukti ke kasir"
        },
        {
            "id": "ch-002", "type": "bank_transfer",
            "label": "Transfer BCA",
            "bank_name": "BCA", "account_number": "1234567890", "account_name": "Kafe Pesanin",
            "instructions": "Transfer ke rekening BCA di atas, lalu tunjukkan bukti ke kasir"
        },
        {
            "id": "ch-003", "type": "cash",
            "label": "Tunai / Cash",
            "instructions": "Bayar langsung ke kasir dengan menunjukkan nomor pesanan Anda"
        }
    ]',
    '{
        "header_text": "Kafe Pesanin Demo\nJl. Contoh No. 123\nTelp: 08123456789",
        "footer_text": "Terima kasih! Follow kami @kafepesanin",
        "show_logo": true
    }'
);

-- Kategori
INSERT INTO categories (id, tenant_id, name, sort_order) VALUES
    ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Kopi Panas',     1),
    ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Kopi Dingin',    2),
    ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Makanan Ringan', 3),
    ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Non-Kopi',       4);

-- Produk
INSERT INTO products (id, tenant_id, category_id, name, description, base_price, labels, sort_order, is_featured) VALUES
    ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001',
     'Americano',      'Espresso dengan air panas, bold dan clean',      22000, ARRAY['best_seller'],       1, TRUE),
    ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001',
     'Cappuccino',     'Espresso dengan foam susu creamy',               28000, ARRAY[]::TEXT[],            2, FALSE),
    ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002',
     'Es Kopi Susu',   'Kopi susu dingin kekinian yang segar',           25000, ARRAY['best_seller','new'], 1, TRUE),
    ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000003',
     'Croissant',      'Croissant renyah dengan mentega premium',        18000, ARRAY[]::TEXT[],            1, FALSE),
    ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000004',
     'Matcha Latte',   'Matcha Jepang premium dengan susu segar',        30000, ARRAY['recommended'],       1, TRUE);

-- Varian Es Kopi Susu
INSERT INTO product_variant_groups (id, product_id, tenant_id, name, is_required, max_selections, sort_order) VALUES
    ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Ukuran',        TRUE, 1, 1),
    ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-000000000001', 'Tingkat Manis', TRUE, 1, 2);

INSERT INTO product_variant_options (group_id, tenant_id, name, additional_price, sort_order) VALUES
    ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', 'Regular (16oz)', 0,    1),
    ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', 'Large (22oz)',   5000, 2),
    ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'Less Sweet',     0,    1),
    ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'Normal',         0,    2),
    ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'Extra Sweet',    0,    3);

-- Meja demo
INSERT INTO tables (tenant_id, table_number, display_name) VALUES
    ('00000000-0000-0000-0000-000000000001', '01',    'Meja 01'),
    ('00000000-0000-0000-0000-000000000001', '02',    'Meja 02'),
    ('00000000-0000-0000-0000-000000000001', '03',    'Meja 03'),
    ('00000000-0000-0000-0000-000000000001', '04',    'Meja 04'),
    ('00000000-0000-0000-0000-000000000001', '05',    'Meja 05'),
    ('00000000-0000-0000-0000-000000000001', 'VIP-1', 'Meja VIP 1');

-- ============================================================
-- SELESAI — Next Steps:
-- 1. Run file ini di Supabase SQL Editor
-- 2. Buat akun Super Admin di Authentication → Users
-- 3. INSERT INTO profiles (user_id, role) VALUES ('[auth-uid]', 'SUPER_ADMIN');
-- 4. Set environment variables di Next.js (.env.local):
--    NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
--    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
--    SUPABASE_SERVICE_ROLE_KEY=eyJ...   ← JANGAN expose ke client!
-- 5. Notifikasi audio kasir: gunakan Web Audio API atau <audio> tag
--    di Supabase Realtime INSERT listener channel orders
-- ============================================================
