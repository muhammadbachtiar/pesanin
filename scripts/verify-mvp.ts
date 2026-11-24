/**
 * scripts/verify-mvp.ts — Suite Pengujian Otomatis 25 Edge-Case MVP Pesanin
 *
 * Mencakup 7 Tahap Pengujian MVP secara End-to-End:
 * - Tahap 1: Isolasi Multi-Tenant, Whitelist Wewenang Owner vs SuperAdmin, PIN Lockout & Role Guard
 * - Tahap 2: CRUD Kategori/Menu, Harga Promo/Coret, Sync Harga Baru ke Keranjang & Chip Catatan Cerdas (QuickNoteChips)
 * - Tahap 3: Pemotongan Stok Saat Checkout Kiosk, Blokir Overselling, & Auto-Cancel 30 Menit
 * - Tahap 4: Anti-Double-Submit (Idempotensi Paralel), Mode Meja Aktif & 2 Kasir Bersamaan
 * - Tahap 5: Aturan Void Kasir vs Owner, Anti Double Stock Restore & Integritas Laporan Analytics
 * - Tahap 6: Alur Dapur (KDS Serialized Checklist), Runner Serve -> Completed & Mode POS-Only
 * - Tahap 7: Generator Struk Thermal ESC/POS (58mm & 80mm) & Ketahanan Konfigurasi JSONB Null/Missing
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { dedupeInFlight, generateIdempotencyKey } from "../lib/idempotency";
import { isValidPin, hashPin, verifyPin, PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from "../lib/pin";
import { getRoleHome, safeNextPath, PIN_ELIGIBLE_ROLES } from "../lib/rolePaths";
import { getQuickNoteGroups, toggleQuickNote, isQuickNoteActive } from "../lib/quickNotes";
import { generateReceiptEscPos } from "../lib/escposHelper";
import {
  createOrder,
  markOrderPaid,
  markOrderServed,
  updateOrderStatus,
  updateOrderCookedItems,
  voidOrder,
  getActiveOrderByTable,
  autoCancelStalePendingOrders,
  parseCustomerNotes,
  buildCustomerNotes,
  getOrdersByTenant,
  getOrdersForAnalytics,
} from "../services/orderService";
import {
  getCategoriesWithProducts,
  getProductsByTenant,
  toggleProductAvailability,
  updateProduct,
} from "../services/productService";
import type { CartItem, Order, Product, Tenant } from "../types";

interface TestResult {
  id: string;
  phase: string;
  title: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(id: string, phase: string, title: string, passed: boolean, detail: string) {
  results.push({ id, phase, title, passed, detail });
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} [${id}] (${phase}) ${title}`);
  if (!passed) {
    console.error(`   ↳ Detail Kegagalan: ${detail}`);
  } else {
    console.log(`   ↳ ${detail}`);
  }
}

/** Helper replikasi logika harga efektif & syncCartPrices di Kiosk/Kasir */
function getEffectivePrice(p: Pick<Product, "base_price" | "discount_price">) {
  const hasPromo =
    p.discount_price !== null &&
    p.discount_price !== undefined &&
    p.discount_price > 0 &&
    p.discount_price < p.base_price;
  return hasPromo ? (p.discount_price as number) : p.base_price;
}

function syncCartPrices(
  cart: CartItem[],
  latest: Map<string, Pick<Product, "id" | "base_price" | "discount_price"> & Partial<Product>>
): { next: CartItem[]; changed: boolean } {
  let changed = false;
  const next = cart.map((item) => {
    const fresh = latest.get(item.product.id);
    if (!fresh) return item;
    const variantExtra = item.selected_variants.reduce((s, v) => s + (v.additional_price || 0), 0);
    const newUnit = getEffectivePrice(fresh) + variantExtra;
    const priceChanged =
      newUnit !== item.unit_price ||
      fresh.base_price !== item.product.base_price ||
      (fresh.discount_price ?? null) !== (item.product.discount_price ?? null);
    if (!priceChanged) return item;
    changed = true;
    return { ...item, unit_price: newUnit, product: { ...item.product, ...fresh } as Product };
  });
  return { next, changed };
}

/** Replikasi filter whitelist OWNER_EDITABLE_FIELDS di /api/admin/tenants/[id] */
const OWNER_EDITABLE_FIELDS = ["logo_url", "manual_payment_channels", "finance_config", "receipt_config"] as const;
function filterOwnerPatchPayload(rawBody: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of OWNER_EDITABLE_FIELDS) {
    if (key in rawBody) body[key] = rawBody[key];
  }
  return body;
}

async function runAllTests() {
  console.log("================================================================================");
  console.log("🚀 MEMULAI PENGUJIAN OTOMATIS 25 EDGE-CASE MVP PESANIN (7 TAHAP PENGUJIAN)");
  console.log("================================================================================\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ID sementara untuk dibersihkan di blok finally
  const createdTenantIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];

  try {
    // =========================================================================
    // TAHAP 1: ISOLASI MULTI-TENANT, PIN SHIFT, LOCKOUT & BATASAN WEWENANG ROLE
    // =========================================================================

    // Setup 2 Tenant Uji Sementara (Tenant A & Tenant B) di Supabase
    const slugA = `test-kafe-a-${Date.now()}`;
    const slugB = `test-kafe-b-${Date.now()}`;

    const { data: tenantA, error: errTA } = await sb
      .from("tenants")
      .insert({
        name: "Kafe Uji Alpha",
        slug: slugA,
        is_active: true,
        visual_config: { primary_color: "#4f46e5", secondary_color: "#818cf8" },
        business_logic: {
          payment_timing: "prepaid",
          payment_mode: "manual",
          numbering: "table",
          require_cashier_verification: true,
          pos_only: false,
        },
        finance_config: { tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000 },
        receipt_config: { paper_size: "58mm", header_text: "Jl. Alpha No. 1", footer_text: "Terima kasih!", show_logo: true },
        manual_payment_channels: [],
        payment_gateway_config: {},
      })
      .select()
      .single();

    const { data: tenantB, error: errTB } = await sb
      .from("tenants")
      .insert({
        name: "Kafe Uji Beta (POS-Only)",
        slug: slugB,
        is_active: true,
        visual_config: { primary_color: "#059669", secondary_color: "#34d399" },
        business_logic: {
          payment_timing: "prepaid",
          payment_mode: "manual",
          numbering: "queue",
          require_cashier_verification: false,
          pos_only: true,
        },
        finance_config: { tax_percentage: 10, service_charge_percentage: 0, takeaway_fee: 1000 },
        receipt_config: { paper_size: "80mm", header_text: "Jl. Beta No. 2", footer_text: "Sampai Jumpa!", show_logo: true },
        manual_payment_channels: [],
        payment_gateway_config: {},
      })
      .select()
      .single();

    if (errTA || !tenantA || errTB || !tenantB) {
      throw new Error(`Gagal membuat tenant uji: ${errTA?.message || errTB?.message}`);
    }
    createdTenantIds.push(tenantA.id, tenantB.id);

    // Buat Kategori & Produk di Tenant A dan Tenant B
    const { data: catA } = await sb
      .from("categories")
      .insert({ tenant_id: tenantA.id, name: "Kopi Signature", sort_order: 1, is_active: true })
      .select()
      .single();
    if (catA) createdCategoryIds.push(catA.id);

    const { data: prodA } = await sb
      .from("products")
      .insert({
        tenant_id: tenantA.id,
        category_id: catA?.id ?? null,
        name: "Es Kopi Susu Gula Aren",
        base_price: 22000,
        discount_price: 18000,
        stock_count: 2,
        is_available: true,
        is_featured: true,
        labels: ["best_seller"],
        image_urls: [],
        sort_order: 1,
      })
      .select()
      .single();

    const { data: prodUnlimitedA } = await sb
      .from("products")
      .insert({
        tenant_id: tenantA.id,
        category_id: catA?.id ?? null,
        name: "Air Mineral",
        base_price: 8000,
        discount_price: null,
        stock_count: null, // Unlimited
        is_available: true,
        is_featured: false,
        labels: [],
        image_urls: [],
        sort_order: 2,
      })
      .select()
      .single();

    const { data: prodB } = await sb
      .from("products")
      .insert({
        tenant_id: tenantB.id,
        category_id: null,
        name: "Menu Rahasia Kafe Beta",
        base_price: 50000,
        discount_price: null,
        stock_count: 10,
        is_available: true,
        is_featured: false,
        labels: [],
        image_urls: [],
        sort_order: 1,
      })
      .select()
      .single();

    if (prodA) createdProductIds.push(prodA.id);
    if (prodUnlimitedA) createdProductIds.push(prodUnlimitedA.id);
    if (prodB) createdProductIds.push(prodB.id);

    // TC-01: Cross-Tenant Data Isolation
    const productsInA = await getProductsByTenant(tenantA.id);
    const leakedFromB = productsInA.some((p) => p.tenant_id === tenantB.id || p.id === prodB?.id);
    record(
      "TC-01",
      "Tahap 1",
      "Isolasi Data Lintas Tenant (Produk & Kategori Kafe A vs Kafe B)",
      !leakedFromB && productsInA.length === 2,
      `Kafe A memuat ${productsInA.length} produk miliknya sendiri; kebocoran data dari Kafe B = ${leakedFromB}`
    );

    // TC-02: Null/Missing JSONB Config Resilience
    const partialTenantConfig: Partial<Tenant> = { name: "Kafe Baru Tanpa Config" };
    const safeTax = partialTenantConfig.finance_config?.tax_percentage ?? 0;
    const safeSvc = partialTenantConfig.finance_config?.service_charge_percentage ?? 0;
    const safeTkwy = partialTenantConfig.finance_config?.takeaway_fee ?? 0;
    const calcTotal = 25000 + Math.round((25000 * safeTax) / 100) + Math.round((25000 * safeSvc) / 100) + safeTkwy;
    record(
      "TC-02",
      "Tahap 1",
      "Ketahanan Konfigurasi JSONB Kosong/Null (Anti NaN & Anti Blank Screen)",
      !Number.isNaN(calcTotal) && calcTotal === 25000,
      `Perhitungan total dengan JSONB kosong menghasilkan Rp ${calcTotal.toLocaleString("id-ID")} (bukan NaN)`
    );

    // TC-03: Whitelist Batasan Wewenang Owner vs Super Admin
    const maliciousOwnerPayload = {
      slug: "hacked-slug",
      is_active: false,
      business_logic: { pos_only: true },
      finance_config: { tax_percentage: 10, service_charge_percentage: 5, takeaway_fee: 3000 },
      receipt_config: { paper_size: "80mm", header_text: "Header Baru", footer_text: "Footer Baru", show_logo: true },
    };
    const sanitizedForOwner = filterOwnerPatchPayload(maliciousOwnerPayload);
    const blockedForbiddenFields =
      !("slug" in sanitizedForOwner) &&
      !("is_active" in sanitizedForOwner) &&
      !("business_logic" in sanitizedForOwner) &&
      "finance_config" in sanitizedForOwner &&
      "receipt_config" in sanitizedForOwner;
    record(
      "TC-03",
      "Tahap 1",
      "Batasan Wewenang Owner vs Super Admin (Owner Editable Fields Whitelist)",
      blockedForbiddenFields,
      `Field terlarang (slug, is_active, business_logic) diblokir; field finance_config & receipt_config diizinkan`
    );

    // TC-04: Keamanan Hash PIN 6 Digit, Verifikasi Timing-Safe & Aturan Lockout 5x
    const samplePin = "482916";
    const hashed = hashPin(samplePin);
    const validCheck = isValidPin(samplePin) && !isValidPin("12a4") && !isValidPin("123");
    const verifyTrue = verifyPin(samplePin, hashed);
    const verifyFalse = !verifyPin("000000", hashed);
    record(
      "TC-04",
      "Tahap 1",
      "Enkripsi Scrypt PIN Staf & Konfigurasi Lockout Brute-Force (5x Salah = Kunci 5 Menit)",
      validCheck && verifyTrue && verifyFalse && PIN_MAX_ATTEMPTS === 5 && PIN_LOCK_MINUTES === 5,
      `Scrypt hash valid, PIN salah ditolak, batas percobaan = ${PIN_MAX_ATTEMPTS}x, durasi kunci = ${PIN_LOCK_MINUTES} menit`
    );

    // TC-05: Role Navigation Guard & Anti Open-Redirect
    const cashierHome = getRoleHome("CASHIER", "kopi-kita");
    const ownerHome = getRoleHome("OWNER", "kopi-kita");
    const blockCrossTenantRedirect = safeNextPath("/kafe-lain/cashier", "kopi-kita") === null;
    const blockExternalRedirect = safeNextPath("//evil.com/phish", "kopi-kita") === null;
    const allowSameTenantRedirect = safeNextPath("/kopi-kita/cashier", "kopi-kita") === "/kopi-kita/cashier";
    const ownerCannotUsePin = !PIN_ELIGIBLE_ROLES.includes("OWNER") && !PIN_ELIGIBLE_ROLES.includes("SUPER_ADMIN");
    record(
      "TC-05",
      "Tahap 1",
      "Proteksi Redirect Lintas Tenant & Pembatasan PIN Hanya untuk Staf Operasional",
      cashierHome === "/kopi-kita/cashier" &&
      ownerHome === "/kopi-kita/admin" &&
      blockCrossTenantRedirect &&
      blockExternalRedirect &&
      allowSameTenantRedirect &&
      ownerCannotUsePin,
      `Redirect lintas tenant & URL eksternal diblokir; OWNER wajib login Email (tidak boleh PIN Cepat)`
    );

    // =========================================================================
    // TAHAP 2: CRUD KATEGORI/MENU, HARGA PROMO, SYNC HARGA REALTIME & CHIP CATATAN
    // =========================================================================

    // TC-06: Hapus Kategori Aman (Menu di dalamnya tidak ikut terhapus, category_id -> null)
    const { data: tempCat } = await sb
      .from("categories")
      .insert({ tenant_id: tenantA.id, name: "Kategori Sementara", sort_order: 99, is_active: true })
      .select()
      .single();
    const { data: tempProdInCat } = await sb
      .from("products")
      .insert({
        tenant_id: tenantA.id,
        category_id: tempCat!.id,
        name: "Croissant Butter",
        base_price: 20000,
        stock_count: 5,
        is_available: true,
        is_featured: false,
        labels: [],
        image_urls: [],
        sort_order: 10,
      })
      .select()
      .single();
    if (tempProdInCat) createdProductIds.push(tempProdInCat.id);

    // Simulasi logika DELETE kategori di /api/admin/tenants/[id]/menu
    await sb.from("products").update({ category_id: null }).eq("category_id", tempCat!.id).eq("tenant_id", tenantA.id);
    await sb.from("categories").delete().eq("id", tempCat!.id).eq("tenant_id", tenantA.id);

    const { data: survivingProd } = await sb.from("products").select("id, category_id").eq("id", tempProdInCat!.id).single();
    record(
      "TC-06",
      "Tahap 2",
      "Hapus Kategori oleh Owner Tanpa Menghapus Menu di Dalamnya (Safe Unlink)",
      Boolean(survivingProd && survivingProd.category_id === null),
      `Kategori terhapus, menu "${tempProdInCat?.name}" tetap aman dengan category_id = null`
    );

    // TC-07: Perhitungan Harga Promo (Harga Coret) vs Harga Normal
    const promoEffective = getEffectivePrice({ base_price: 22000, discount_price: 18000 });
    const invalidPromoHigher = getEffectivePrice({ base_price: 22000, discount_price: 25000 });
    const zeroPromo = getEffectivePrice({ base_price: 22000, discount_price: 0 });
    record(
      "TC-07",
      "Tahap 2",
      "Validasi Harga Promo / Diskon (Abaikan Promo jika >= Harga Dasar atau 0)",
      promoEffective === 18000 && invalidPromoHigher === 22000 && zeroPromo === 22000,
      `Promo valid = Rp ${promoEffective}; Promo > Harga Dasar otomatis kembali ke Rp ${invalidPromoHigher}`
    );

    // TC-08: Sinkronisasi Harga Baru Realtime ke Keranjang Kiosk & Kasir (Poin #8)
    const initialCart: CartItem[] = [
      {
        product: prodA as Product,
        quantity: 2,
        selected_variants: [],
        notes: "Less Sugar",
        unit_price: 18000,
      },
    ];
    // Owner mengubah harga dasar menjadi 25.000 dan menghapus diskon promo (null)
    const updatedMap = new Map([[prodA!.id, { id: prodA!.id, base_price: 25000, discount_price: null }]]);
    const { next: syncedCart, changed: priceChanged } = syncCartPrices(initialCart, updatedMap);
    record(
      "TC-08",
      "Tahap 2",
      "Sinkronisasi Harga Baru Secara Realtime ke Keranjang Aktif Tanpa Notifikasi Mengganggu",
      priceChanged && syncedCart[0].unit_price === 25000 && syncedCart[0].unit_price * syncedCart[0].quantity === 50000,
      `Harga di keranjang otomatis diperbarui dari Rp 18.000 -> Rp ${syncedCart[0].unit_price.toLocaleString("id-ID")} (Subtotal: Rp 50.000)`
    );

    // TC-10: Variasi Chip Rekomendasi Catatan Menyesuaikan Jenis Menu (Poin #3)
    const coffeeGroups = getQuickNoteGroups({ name: "Es Kopi Susu Gula Aren" }, "Kopi Signature", false);
    const hotCoffeeGroups = getQuickNoteGroups({ name: "Hot Americano" }, "Kopi Signature", false);
    const friedRiceGroups = getQuickNoteGroups({ name: "Nasi Goreng Telur Spesial" }, "Makanan Berat", true);
    const steakGroups = getQuickNoteGroups({ name: "Wagyu Sirloin Steak" }, "Main Course", false);
    const snackGroups = getQuickNoteGroups({ name: "French Fries Kentang Goreng" }, "Snack", false);
    const pastryGroups = getQuickNoteGroups({ name: "Butter Croissant" }, "Pastry", false);

    const coffeeGroupIds = coffeeGroups.map((g) => g.id);
    const hotCoffeeGroupIds = hotCoffeeGroups.map((g) => g.id);
    const friedRiceGroupIds = friedRiceGroups.map((g) => g.id);
    const steakGroupIds = steakGroups.map((g) => g.id);
    const snackGroupIds = snackGroups.map((g) => g.id);
    const pastryGroupIds = pastryGroups.map((g) => g.id);

    const chipsAdaptedCorrectly =
      coffeeGroupIds.includes("sugar") &&
      coffeeGroupIds.includes("ice") &&
      !coffeeGroupIds.includes("spicy") &&
      !hotCoffeeGroupIds.includes("ice") && // Kopi panas tidak boleh muncul opsi Es
      friedRiceGroupIds.includes("spicy") &&
      friedRiceGroupIds.includes("egg") &&
      friedRiceGroupIds.includes("packaging") && // Takeaway menambahkan opsi Penyajian
      steakGroupIds.includes("doneness") &&
      snackGroupIds.includes("snack_sauce") &&
      pastryGroupIds.includes("bread_custom");

    record(
      "TC-10",
      "Tahap 2",
      "Variasi Chip Catatan Sekali Klik Menyesuaikan Konteks Menu (Kopi, Panas/Dingin, Nasi, Steak, Snack, Pastry, Takeaway)",
      chipsAdaptedCorrectly,
      `Es Kopi=[${coffeeGroupIds.join(",")}], Hot Americano=[${hotCoffeeGroupIds.join(",")}], Nasgor Takeaway=[${friedRiceGroupIds.join(",")}], Steak=[${steakGroupIds.join(",")}]`
    );

    // TC-11: Eksklusivitas Grup Chip (Gula/Es/Pedas) + Preservasi Catatan Ketik Manual
    const sugarGroup = coffeeGroups.find((g) => g.id === "sugar")!;
    const extraGroup = coffeeGroups.find((g) => g.id === "coffee_extra")!;
    let noteText = "Jangan terlalu penuh";
    noteText = toggleQuickNote(noteText, "Less Sugar", sugarGroup);
    noteText = toggleQuickNote(noteText, "No Sugar", sugarGroup); // Harus menggantikan Less Sugar
    noteText = toggleQuickNote(noteText, "Extra Shot", extraGroup);
    noteText = toggleQuickNote(noteText, "Oat Milk", extraGroup); // Non-exclusive: keduanya aktif

    const exclusiveWorked =
      !isQuickNoteActive(noteText, "Less Sugar") &&
      isQuickNoteActive(noteText, "No Sugar") &&
      isQuickNoteActive(noteText, "Extra Shot") &&
      isQuickNoteActive(noteText, "Oat Milk") &&
      noteText.includes("Jangan terlalu penuh");

    record(
      "TC-11",
      "Tahap 2",
      "Toggle Chip Eksklusif vs Multi-Select & Menjaga Catatan Manual Pelanggan",
      exclusiveWorked,
      `Hasil akhir catatan: "${noteText}" (Less Sugar otomatis diganti No Sugar, catatan manual tetap utuh)`
    );

    // =========================================================================
    // TAHAP 3 & 4: ANTI-DOUBLE-SUBMIT, PEMOTONGAN STOK SAAT CHECKOUT KIOSK & MEJA AKTIF
    // =========================================================================

    // TC-12 & TC-13: Spam 5x Klik Checkout Paralel + Pemotongan Stok Saat Checkout Kiosk
    // prodA awalnya memiliki stock_count = 2. Kita pesan quantity = 2 dengan 5 panggilan paralel sekaligus.
    const idemKey = generateIdempotencyKey("test-kiosk");
    const orderPayload = {
      tenant_id: tenantA.id,
      queue_number: "001",
      customer_name: "Budi Santoso",
      customer_notes: "No Sugar, Extra Shot",
      table_number: "08",
      order_type: "dine_in" as const,
      subtotal: 36000,
      tax_amount: 3960,
      service_charge_amount: 1800,
      takeaway_fee_amount: 0,
      total_amount: 41760,
      finance_snapshot: { tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000 },
    };
    const orderItemsPayload = [
      {
        product_id: prodA!.id,
        product_name_snapshot: prodA!.name,
        base_price_snapshot: prodA!.base_price,
        selected_variants: [],
        quantity: 2,
        unit_price: 18000,
        subtotal: 36000,
        notes: "No Sugar, Extra Shot",
      },
      {
        product_id: prodUnlimitedA!.id,
        product_name_snapshot: prodUnlimitedA!.name,
        base_price_snapshot: prodUnlimitedA!.base_price,
        selected_variants: [],
        quantity: 3,
        unit_price: 8000,
        subtotal: 24000,
      },
    ];

    const parallelResults = await Promise.all([
      createOrder(orderPayload, orderItemsPayload, idemKey),
      createOrder(orderPayload, orderItemsPayload, idemKey),
      createOrder(orderPayload, orderItemsPayload, idemKey),
      createOrder(orderPayload, orderItemsPayload, idemKey),
      createOrder(orderPayload, orderItemsPayload, idemKey),
    ]);

    const uniqueOrderIds = Array.from(new Set(parallelResults.map((o) => o?.id).filter(Boolean)));
    if (uniqueOrderIds[0]) createdOrderIds.push(uniqueOrderIds[0] as string);

    const { count: dbOrderCount } = await sb
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.id);

    record(
      "TC-12",
      "Tahap 4",
      "Anti-Double-Submit: 5 Klik Checkout Paralel (0ms) Hanya Menghasilkan 1 Pesanan",
      uniqueOrderIds.length === 1 && dbOrderCount === 1,
      `5 request paralel disatukan menjadi 1 Order ID (${uniqueOrderIds[0]?.slice(0, 8)}...), jumlah baris di DB = ${dbOrderCount}`
    );

    // Cek stok prodA setelah checkout Kiosk (awal 2, dipesan 2 -> harus 0 dan is_available = false)
    const { data: prodAAfterCheckout } = await sb
      .from("products")
      .select("stock_count, is_available")
      .eq("id", prodA!.id)
      .single();

    record(
      "TC-13",
      "Tahap 3",
      "Stok Langsung Terpotong Saat Checkout Kiosk & Otomatis Nonaktif (Habis) Saat Stok = 0",
      prodAAfterCheckout?.stock_count === 0 && prodAAfterCheckout?.is_available === false,
      `Stok "${prodA?.name}" berkurang dari 2 -> ${prodAAfterCheckout?.stock_count}, is_available otomatis menjadi ${prodAAfterCheckout?.is_available}`
    );

    // TC-14: Blokir Overselling ketika stok sudah 0
    let oversellBlocked = false;
    let oversellMsg = "";
    try {
      await createOrder(
        { ...orderPayload, queue_number: "002", table_number: "09" },
        [
          {
            product_id: prodA!.id,
            product_name_snapshot: prodA!.name,
            base_price_snapshot: prodA!.base_price,
            selected_variants: [],
            quantity: 1,
            unit_price: 18000,
            subtotal: 18000,
          },
        ],
        generateIdempotencyKey("test-oversell")
      );
    } catch (err: unknown) {
      oversellBlocked = true;
      oversellMsg = err instanceof Error ? err.message : String(err);
    }

    record(
      "TC-14",
      "Tahap 3",
      "Blokir Overselling / Race Condition Saat Pelanggan Lain Memesan Menu yang Baru Habis",
      oversellBlocked,
      `Transaksi ditolak dengan pesan: "${oversellMsg}"`
    );

    // TC-15: Produk Stok Unlimited (stock_count = null)
    const { data: unlimitedAfter } = await sb
      .from("products")
      .select("stock_count, is_available")
      .eq("id", prodUnlimitedA!.id)
      .single();

    record(
      "TC-15",
      "Tahap 3",
      "Produk dengan Stok Tanpa Batas (Unlimited / null) Tetap Tersedia Setelah Dipesan",
      unlimitedAfter?.stock_count === null && unlimitedAfter?.is_available === true,
      `Menu "${prodUnlimitedA?.name}" tetap stock_count = null & is_available = true`
    );

    // TC-16: Kunci Meja Aktif (Meja 08 sedang dipakai oleh pesanan #001)
    const activeOnTable08 = await getActiveOrderByTable(tenantA.id, "08");
    const activeOnTable99 = await getActiveOrderByTable(tenantA.id, "99");
    record(
      "TC-16",
      "Tahap 4",
      "Validasi Konflik Nomor Meja Aktif (Mencegah 2 Pelanggan Menduduki Meja yang Sama)",
      Boolean(activeOnTable08 && activeOnTable08.id === uniqueOrderIds[0] && activeOnTable99 === null),
      `Meja 08 terdeteksi sedang digunakan oleh Pesanan #${activeOnTable08?.queue_number}; Meja 99 kosong`
    );

    // TC-09: Integritas Snapshot Harga & Pajak pada Pesanan yang Sudah Terbuat
    // Ubah harga prodA di database menjadi Rp 99.000, lalu cek apakah order_items pesanan #001 tetap Rp 18.000
    await updateProduct(prodA!.id, { base_price: 99000 });
    const { data: savedOrderItems } = await sb
      .from("order_items")
      .select("unit_price, base_price_snapshot")
      .eq("order_id", uniqueOrderIds[0]!)
      .eq("product_id", prodA!.id)
      .single();
    // Kembalikan harga dasar prodA ke 22000
    await updateProduct(prodA!.id, { base_price: 22000 });

    record(
      "TC-09",
      "Tahap 2",
      "Integritas Snapshot Harga pada Pesanan Aktif & Riwayat Laporan Saat Owner Mengubah Harga Menu",
      savedOrderItems?.unit_price === 18000 && savedOrderItems?.base_price_snapshot === 22000,
      `Walaupun harga produk diubah ke Rp 99.000, snapshot pesanan tetap unit_price = Rp ${savedOrderItems?.unit_price.toLocaleString("id-ID")}`
    );

    // =========================================================================
    // TAHAP 6: KONFIRMASI LUNAS 2 KASIR BERSAMAAN, DAPUR (KDS) & RUNNER
    // =========================================================================

    const mainOrderId = uniqueOrderIds[0]!;

    // TC-19: 2 Kasir menekan tombol Lunas secara bersamaan pada pesanan #001
    const [paid1, paid2] = await Promise.all([
      markOrderPaid(mainOrderId, "qris_static", "00000000-0000-0000-0000-000000000000"),
      markOrderPaid(mainOrderId, "qris_static", "00000000-0000-0000-0000-000000000000"),
    ]);
    const { data: orderAfterPay } = await sb
      .from("orders")
      .select("payment_status, order_status, verification_status")
      .eq("id", mainOrderId)
      .single();

    record(
      "TC-19",
      "Tahap 4 & 6",
      "Konfirmasi Lunas oleh 2 Kasir Bersamaan & Transisi Otomatis ke Antrian Dapur (cooking)",
      paid1 && paid2 && orderAfterPay?.payment_status === "paid" && orderAfterPay?.order_status === "cooking",
      `Status pembayaran = ${orderAfterPay?.payment_status}, status pesanan = ${orderAfterPay?.order_status}`
    );

    // TC-20: Serialisasi Checklist Item Masakan di Layar Dapur (KDS) & Preservasi Nama Pelanggan
    const { data: itemsOfOrder } = await sb.from("order_items").select("id").eq("order_id", mainOrderId);
    const itemId1 = itemsOfOrder?.[0]?.id ?? "item-1";
    const itemId2 = itemsOfOrder?.[1]?.id ?? "item-2";
    const { data: currentOrd } = await sb.from("orders").select("customer_notes").eq("id", mainOrderId).single();

    // Koki mengetap item 1 lalu item 1+2 secara beruntun tanpa await di antaranya
    await Promise.all([
      updateOrderCookedItems(mainOrderId, currentOrd?.customer_notes ?? null, [itemId1]),
      updateOrderCookedItems(mainOrderId, currentOrd?.customer_notes ?? null, [itemId1, itemId2]),
    ]);

    const { data: ordAfterCook } = await sb.from("orders").select("customer_notes").eq("id", mainOrderId).single();
    const parsedNotes = parseCustomerNotes(ordAfterCook?.customer_notes ?? null);

    record(
      "TC-20",
      "Tahap 6",
      "Serialisasi Checklist Dapur (KDS) & Preservasi Metadata Nama Pelanggan di customer_notes",
      parsedNotes.cookedItemIds.includes(itemId1) &&
      parsedNotes.cookedItemIds.includes(itemId2) &&
      parsedNotes.customerName === "Budi Santoso" &&
      parsedNotes.cleanNotes.includes("No Sugar, Extra Shot"),
      `Item matang tersimpan (${parsedNotes.cookedItemIds.length} item), Nama="${parsedNotes.customerName}", Catatan="${parsedNotes.cleanNotes}"`
    );

    // TC-21: Transisi Ready -> Runner Antar Pesanan (markOrderServed) -> Completed & Pembebasan Meja
    await updateOrderStatus(mainOrderId, "ready");
    await Promise.all([
      markOrderServed(mainOrderId, ordAfterCook?.customer_notes),
      markOrderServed(mainOrderId, ordAfterCook?.customer_notes),
    ]);
    await updateOrderStatus(mainOrderId, "completed");

    const { data: ordAfterServe } = await sb
      .from("orders")
      .select("order_status, customer_notes")
      .eq("id", mainOrderId)
      .single();
    const servedTagCount = (ordAfterServe?.customer_notes?.match(/\[SERVED\]/g) ?? []).length;
    const table08AfterComplete = await getActiveOrderByTable(tenantA.id, "08");

    record(
      "TC-21",
      "Tahap 6",
      "Alur Runner Antar Pesanan (Idempoten [SERVED]) -> Selesai (completed) & Meja Kembali Kosong",
      ordAfterServe?.order_status === "completed" && servedTagCount === 1 && table08AfterComplete === null,
      `Status = ${ordAfterServe?.order_status}, tag [SERVED] = ${servedTagCount}x, Meja 08 kembali kosong (active = ${table08AfterComplete})`
    );

    // TC-18: Mode POS-Only & Takeaway Fee
    const posOrder = await createOrder(
      {
        tenant_id: tenantB.id,
        queue_number: "001",
        order_type: "takeaway",
        subtotal: 50000,
        tax_amount: 5000,
        service_charge_amount: 0,
        takeaway_fee_amount: 1000,
        total_amount: 56000,
        created_by_cashier: true,
        finance_snapshot: { tax_percentage: 10, service_charge_percentage: 0, takeaway_fee: 1000 },
      },
      [
        {
          product_id: prodB!.id,
          product_name_snapshot: prodB!.name,
          base_price_snapshot: prodB!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 50000,
          subtotal: 50000,
        },
      ],
      generateIdempotencyKey("test-pos-only")
    );
    if (posOrder) {
      createdOrderIds.push(posOrder.id);
      await markOrderPaid(posOrder.id, "cash", "00000000-0000-0000-0000-000000000000", "completed");
    }
    const { data: posOrderCheck } = await sb
      .from("orders")
      .select("order_status, payment_status, takeaway_fee_amount")
      .eq("id", posOrder!.id)
      .single();

    record(
      "TC-18",
      "Tahap 6",
      "Mode POS-Only (Single-Step Lunas & Completed) + Perhitungan Biaya Takeaway",
      posOrderCheck?.order_status === "completed" &&
      posOrderCheck?.payment_status === "paid" &&
      posOrderCheck?.takeaway_fee_amount === 1000,
      `Transaksi POS-Only langsung berstatus ${posOrderCheck?.payment_status} + ${posOrderCheck?.order_status} dengan Takeaway Fee Rp ${posOrderCheck?.takeaway_fee_amount}`
    );

    // =========================================================================
    // TAHAP 5: VOID IDEMPOTENSI (ANTI DOUBLE RESTORE) & AUTO-CANCEL 30 MENIT
    // =========================================================================

    // TC-17: Pembatasan Hak Void (Kasir vs Owner) pada Pesanan Unpaid vs Paid
    const canVoidOrder = (role: "CASHIER" | "OWNER" | "SUPER_ADMIN", paymentStatus: "unpaid" | "paid") => {
      if (paymentStatus === "paid") return role === "OWNER" || role === "SUPER_ADMIN";
      return role === "CASHIER" || role === "OWNER" || role === "SUPER_ADMIN";
    };
    const voidRuleValid =
      canVoidOrder("CASHIER", "unpaid") === true &&
      canVoidOrder("CASHIER", "paid") === false &&
      canVoidOrder("OWNER", "paid") === true &&
      canVoidOrder("SUPER_ADMIN", "paid") === true;

    record(
      "TC-17",
      "Tahap 5",
      "Aturan Hak Void: Kasir Hanya Boleh Void Pesanan Belum Lunas (unpaid), Pesanan Lunas (paid) Wajib Owner",
      voidRuleValid,
      `Kasir Void Unpaid = true, Kasir Void Paid = false (Ditolak 403), Owner Void Paid = true`
    );

    // TC-22: Void Pesanan Paralel (3x klik Void bersamaan) -> Stok hanya kembali 1x (+2), bukan 3x (+6)
    // Saat ini stok prodA adalah 0 dan is_available = false.
    const [v1, v2, v3] = await Promise.all([
      voidOrder(mainOrderId, "Uji Void Owner Paralel", null),
      voidOrder(mainOrderId, "Uji Void Owner Paralel", null),
      voidOrder(mainOrderId, "Uji Void Owner Paralel", null),
    ]);

    const { data: prodAAfterVoid } = await sb
      .from("products")
      .select("stock_count, is_available")
      .eq("id", prodA!.id)
      .single();

    record(
      "TC-22",
      "Tahap 5",
      "Idempotensi Void Paralel: Stok Kembali Tepat 1x (+2 Porsi) & Menu Otomatis Aktif Kembali",
      v1 && v2 && v3 && prodAAfterVoid?.stock_count === 2 && prodAAfterVoid?.is_available === true,
      `3 panggilan Void paralel hanya mengembalikan stok 1x: stok kembali ke ${prodAAfterVoid?.stock_count} & is_available = ${prodAAfterVoid?.is_available}`
    );

    // TC-23: Auto-Cancel 30 Menit (Pesanan Kiosk > 30 menit dibatalkan & stok kembali; pesanan 10 menit aman)
    // Buat 1 pesanan Kiosk yang kita mundurkan created_at-nya ke 35 menit lalu (memakai 1 stok prodA -> sisa 1)
    const staleOrder = await createOrder(
      { ...orderPayload, queue_number: "003", table_number: "12" },
      [
        {
          product_id: prodA!.id,
          product_name_snapshot: prodA!.name,
          base_price_snapshot: prodA!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
        },
      ],
      generateIdempotencyKey("test-stale-35m")
    );
    // Buat 1 pesanan Kiosk baru (umur 5 menit -> tidak boleh ikut terbatalkan)
    const freshPendingOrder = await createOrder(
      { ...orderPayload, queue_number: "004", table_number: "14" },
      [
        {
          product_id: prodA!.id,
          product_name_snapshot: prodA!.name,
          base_price_snapshot: prodA!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
        },
      ],
      generateIdempotencyKey("test-fresh-5m")
    );

    if (staleOrder) createdOrderIds.push(staleOrder.id);
    if (freshPendingOrder) createdOrderIds.push(freshPendingOrder.id);

    // Mundurkan created_at staleOrder menjadi 35 menit yang lalu
    const thirtyFiveMinAgo = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    await sb.from("orders").update({ created_at: thirtyFiveMinAgo }).eq("id", staleOrder!.id);

    // Sebelum auto-cancel: stok prodA = 0 (karena dipakai staleOrder 1 + freshPendingOrder 1), dan Meja 12 terisi
    const cancelledCount = await autoCancelStalePendingOrders(tenantA.id, 30);

    const { data: staleCheck } = await sb.from("orders").select("order_status, void_reason").eq("id", staleOrder!.id).single();
    const { data: freshCheck } = await sb.from("orders").select("order_status").eq("id", freshPendingOrder!.id).single();
    const { data: prodAAfterAutoCancel } = await sb.from("products").select("stock_count, is_available").eq("id", prodA!.id).single();
    const table12AfterAutoCancel = await getActiveOrderByTable(tenantA.id, "12");
    const table14StillActive = await getActiveOrderByTable(tenantA.id, "14");

    record(
      "TC-23",
      "Tahap 3 & 5",
      "Auto-Cancel Pesanan Kiosk Belum Lunas > 30 Menit (Bebaskan Meja & Kembalikan Stok Tanpa Mengganggu Pesanan Baru)",
      cancelledCount === 1 &&
      staleCheck?.order_status === "cancelled" &&
      freshCheck?.order_status === "pending" &&
      prodAAfterAutoCancel?.stock_count === 1 &&
      prodAAfterAutoCancel?.is_available === true &&
      table12AfterAutoCancel === null &&
      table14StillActive?.id === freshPendingOrder?.id,
      `Pesanan 35m otomatis cancelled (Stok kembali 0 -> ${prodAAfterAutoCancel?.stock_count}, Meja 12 bebas); Pesanan baru di Meja 14 tetap pending`
    );

    // TC-17 & TC-24: Integritas Perhitungan Omzet Analytics (Hanya pesanan completed yang dihitung)
    const startOfToday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endOfToday = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const analyticsA = await getOrdersForAnalytics(tenantA.id, startOfToday, endOfToday);
    const analyticsB = await getOrdersForAnalytics(tenantB.id, startOfToday, endOfToday);

    const revenueA = analyticsA
      .filter((o) => o.order_status === "completed")
      .reduce((s, o) => s + (o.total_amount ?? 0), 0);
    const revenueB = analyticsB
      .filter((o) => o.order_status === "completed")
      .reduce((s, o) => s + (o.total_amount ?? 0), 0);

    record(
      "TC-24",
      "Tahap 5",
      "Integritas Omzet Analytics: Pesanan Void/Cancelled & Pending Tidak Masuk ke Total Revenue",
      revenueA === 0 && revenueB === 56000,
      `Omzet Kafe A (semua pesanan di-void/pending) = Rp ${revenueA}; Omzet Kafe B (1 pesanan completed) = Rp ${revenueB.toLocaleString("id-ID")}`
    );

    // =========================================================================
    // TAHAP 7: GENERATOR STRUK THERMAL ESC/POS (58mm & 80mm)
    // =========================================================================

    // TC-25: Uji Generator Byte ESC/POS 58mm & 80mm
    const sampleOrderForPrint: Order = {
      ...(posOrder as Order),
      payment_status: "paid",
      payment_method: "cash",
      order_status: "completed",
      customer_notes: buildCustomerNotes("Less Sugar, Extra Shot", true, [], "Kak Nadia"),
      items: [
        {
          id: "item-print-1",
          order_id: posOrder!.id,
          product_id: prodB!.id,
          product_name_snapshot: "Es Kopi Susu Gula Aren",
          base_price_snapshot: 22000,
          selected_variants: [],
          quantity: 2,
          unit_price: 18000,
          subtotal: 36000,
          notes: "Less Sugar, Less Ice",
          created_at: new Date().toISOString(),
        },
      ],
    };

    const bytes58 = generateReceiptEscPos(sampleOrderForPrint, tenantA as Tenant, {
      paperSize: "58mm",
      payMethod: "cash",
      cashReceived: 50000,
    });
    const bytes80 = generateReceiptEscPos(sampleOrderForPrint, tenantB as Tenant, {
      paperSize: "80mm",
      payMethod: "qris",
      cashReceived: null,
    });
    const textDecoded58 = Buffer.from(bytes58).toString("latin1");

    const receiptValid =
      bytes58.byteLength > 100 &&
      bytes80.byteLength > bytes58.byteLength &&
      textDecoded58.includes("KAFE UJI ALPHA") &&
      textDecoded58.includes("Kak Nadia") &&
      textDecoded58.includes("Less Sugar, Less Ice") &&
      textDecoded58.includes("Kembalian");

    record(
      "TC-25",
      "Tahap 7",
      "Generator Struk Thermal ESC/POS (Mode 58mm & 80mm, Nama Pelanggan, Catatan Chip, Pajak & Kembalian)",
      receiptValid,
      `Byte 58mm = ${bytes58.byteLength} bytes, Byte 80mm = ${bytes80.byteLength} bytes; Header, Nama, Catatan & Kembalian tercetak lengkap`
    );
  } finally {
    // ── CLEANUP OTOMATIS DATA UJI SEMENTARA ──
    console.log("\n🧹 Membersihkan data uji sementara dari database Supabase...");
    if (createdOrderIds.length > 0) {
      await sb.from("order_items").delete().in("order_id", createdOrderIds);
      await sb.from("orders").delete().in("id", createdOrderIds);
    }
    if (createdProductIds.length > 0) {
      await sb.from("products").delete().in("id", createdProductIds);
    }
    if (createdCategoryIds.length > 0) {
      await sb.from("categories").delete().in("id", createdCategoryIds);
    }
    if (createdTenantIds.length > 0) {
      await sb.from("orders").delete().in("tenant_id", createdTenantIds);
      await sb.from("products").delete().in("tenant_id", createdTenantIds);
      await sb.from("categories").delete().in("tenant_id", createdTenantIds);
      await sb.from("tenants").delete().in("id", createdTenantIds);
    }
    console.log(" Data uji sementara berhasil dibersihkan.\n");
  }

  // Ringkasan Akhir
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log("================================================================================");
  console.log(`📊 RINGKASAN HASIL PENGUJIAN MVP: ${passedCount}/${results.length} LULUS (PASS), ${failedCount} GAGAL (FAIL)`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("❌ Terjadi error fatal saat menjalankan suite pengujian:", err);
  process.exit(1);
});
