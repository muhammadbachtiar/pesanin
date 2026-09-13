import postgres from "postgres";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

async function runPatch() {
  const dbUrl = process.env.DATABASE_URL;
  const projectRef = "uenyhqnuhduxdthvxqqy";
  const dbPassword = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD;

  const connectionString =
    dbUrl ||
    (dbPassword
      ? `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
      : null);

  if (!connectionString) {
    console.log("❌ Tidak ditemukan DATABASE_URL atau DB_PASSWORD di .env");
    console.log("\n💡 Cara pakai:");
    console.log("Tambahkan di .env file:");
    console.log("DB_PASSWORD=password_database_supabase_anda");
    console.log("\nLalu jalankan lagi: npm run db:patch");
    process.exit(1);
  }

  console.log("⏳ Menghubungkan ke Supabase PostgreSQL database...");
  const sql = postgres(connectionString, { ssl: "require", max: 1 });

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

    console.log("\n🎉 Migrasi selesai dengan sukses!");
  } catch (err) {
    console.error("❌ Gagal migrasi:", err);
  } finally {
    await sql.end();
  }
}

runPatch();
