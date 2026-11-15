import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const BUCKET_ID = "tenant-assets";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = ["image/webp", "image/jpeg", "image/png"];

async function provisionStorageBucketOverHttps(): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.log("⚠️  NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum ada di .env");
    return false;
  }

  console.log("☁️  [HTTPS API] Memeriksa / membuat bucket Supabase Storage 'tenant-assets'...");
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: getErr } = await sb.storage.getBucket(BUCKET_ID);

  if (existing && !getErr) {
    const { error: updErr } = await sb.storage.updateBucket(BUCKET_ID, {
      public: true,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (updErr) {
      console.error("❌ Gagal memperbarui konfigurasi bucket:", updErr.message);
      return false;
    }
    console.log("✅ Bucket 'tenant-assets' sudah ada & konfigurasi diperbarui (Public, maks 2MB, WebP/JPG/PNG).");
    return true;
  }

  const { error: createErr } = await sb.storage.createBucket(BUCKET_ID, {
    public: true,
    fileSizeLimit: MAX_UPLOAD_BYTES,
    allowedMimeTypes: ALLOWED_MIME,
  });

  if (createErr) {
    console.error("❌ Gagal membuat bucket via HTTPS API:", createErr.message);
    return false;
  }

  console.log("✅ Bucket 'tenant-assets' berhasil dibuat via HTTPS API (Public, maks 2MB, WebP/JPG/PNG)!");
  return true;
}

async function runPatch() {
  // 1. Provision Supabase Storage Bucket via HTTPS REST API (Port 443 — anti blokir ISP / tanpa port 5432)
  const bucketOk = await provisionStorageBucketOverHttps();

  // 2. Jalankan migrasi tabel SQL jika DATABASE_URL (postgresql://...) atau DB_PASSWORD tersedia
  const rawDbUrl = process.env.DATABASE_URL;
  const validPostgresUrl =
    rawDbUrl && (rawDbUrl.startsWith("postgres://") || rawDbUrl.startsWith("postgresql://"))
      ? rawDbUrl
      : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const projectRef = refMatch?.[1] || "uenyhqnuhduxdthvxqqy";
  const dbPassword = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;

  const connectionString =
    validPostgresUrl ||
    (dbPassword
      ? `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
      : null);

  if (!connectionString) {
    if (bucketOk) {
      console.log("\n🎉 Setup Supabase Storage ('tenant-assets') SELESAI dan siap digunakan untuk upload gambar!");
      console.log("ℹ️  Catatan: Migrasi SQL langsung (port 6543/5432) dilewati karena DATABASE_URL / DB_PASSWORD belum diisi di .env.");
      return;
    }
    console.log("❌ Tidak ditemukan DATABASE_URL (postgresql://...) atau DB_PASSWORD di .env");
    console.log("\n💡 Cara pakai:");
    console.log("Pastikan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY terisi di .env,");
    console.log("atau tambahkan DB_PASSWORD=password_database_supabase_anda");
    process.exit(1);
  }

  console.log("\n⏳ Menghubungkan ke Supabase PostgreSQL database...");
  const sql = postgres(connectionString, { ssl: "require", max: 1, connect_timeout: 10 });

  try {
    console.log("🚀 Menjalankan migrasi kolom discount_price...");
    await sql`
      ALTER TABLE public.products 
      ADD COLUMN IF NOT EXISTS discount_price NUMERIC(12, 2);
    `;
    console.log("✅ Kolom discount_price berhasil ditambahkan ke products");

    await sql`
      ALTER TABLE public.order_items 
      ADD COLUMN IF NOT EXISTS discount_price_snapshot NUMERIC(12, 2);
    `;
    console.log("✅ Kolom discount_price_snapshot berhasil ditambahkan ke order_items");

    await sql`NOTIFY pgrst, 'reload schema';`;
    console.log("✅ Schema cache PostgREST berhasil di-reload");

    // PATCH 8 — Quick PIN Login Staf (sinkron dengan schema.sql)
    console.log("🚀 Menjalankan migrasi PATCH 8: tabel staff_pins...");
    await sql`
      CREATE TABLE IF NOT EXISTS public.staff_pins (
        profile_id      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
        pin_hash        TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until    TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    await sql`ALTER TABLE public.staff_pins ENABLE ROW LEVEL SECURITY;`;
    await sql`REVOKE ALL ON public.staff_pins FROM anon, authenticated;`;
    console.log("✅ Tabel staff_pins siap (RLS aktif, hanya service_role)");

    await sql`NOTIFY pgrst, 'reload schema';`;
    console.log("✅ Schema cache PostgREST berhasil di-reload (PATCH 8)");

    console.log("🚀 Menjalankan migrasi PATCH 9: bucket storage tenant-assets...");
    await sql`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('tenant-assets', 'tenant-assets', TRUE, 2097152, ARRAY['image/webp', 'image/jpeg', 'image/png'])
      ON CONFLICT (id) DO UPDATE
      SET public             = EXCLUDED.public,
          file_size_limit    = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
    `;
    console.log("✅ Bucket tenant-assets siap (public read, tulis hanya via /api/upload)");

    console.log("\n🎉 Migrasi selesai dengan sukses!");
  } catch (err) {
    console.error("❌ Gagal migrasi:", err);
  } finally {
    await sql.end();
  }
}

runPatch();
