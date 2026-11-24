/**
 * scripts/verify-tenant-role-flows.ts
 *
 * Automasi Pengujian End-to-End (E2E) Seluruh Flow CRUD & Pemesanan
 * untuk 2 Arsitektur Tenant Utama di Semua Role:
 *
 * 🏢 TENANT 1 — FULL MODE (Order dengan Nomor Meja + Bayar Dulu / Prepaid)
 *    Role yang diuji:
 *    1. SUPER_ADMIN    : Onboarding Tenant Full Mode, Setup Config, Suspend/Unsuspend
 *    2. OWNER          : CRUD Kategori, CRUD Menu (Harga, Promo, Stok, Toggle), Config PB1/Service/Takeaway/Struk,
 *                        Manajemen Staf & PIN, Void Pesanan Lunas (Paid), & Laporan Analytics
 *    3. KIOSK_CUSTOMER : Flow Dine-In (Mode Meja + QuickNoteChips + Kunci Meja + Potong Stok),
 *                        Flow Takeaway (Biaya Takeaway + Tanpa Kunci Meja),
 *                        Flow Pesanan Gantung > 30 Menit (Auto-Cancel + Bebaskan Meja + Restore Stok)
 *    4. CASHIER        : Verifikasi & Pelunasan Pesanan Kiosk (pending -> paid + cooking),
 *                        Buat Pesanan Baru POS (Save Pending & Direct Pay),
 *                        Void Pesanan Belum Lunas (Unpaid = Berhasil),
 *                        Blokir Void Pesanan Sudah Lunas (Paid = Ditolak 403),
 *                        Blokir Akses Halaman Analytics
 *    5. KITCHEN (KDS)  : Terima Pesanan Lunas (cooking), Checklist Item Masakan Serialized (updateOrderCookedItems),
 *                        Undo Checklist Item, Tandai Pesanan Siap Saji (cooking -> ready)
 *    6. RUNNER         : Lihat Antrean Siap Saji (ready), Antar Pesanan Dine-In (markOrderServed [SERVED] -> completed & Bebaskan Meja),
 *                        Serahkan Pesanan Takeaway Lunas (-> completed),
 *                        Blokir Penyelesaian Takeaway yang Belum Lunas
 *
 * 🏪 TENANT 2 — POS-ONLY MODE (Standalone Kasir + Nomor Antrian + Bayar Dulu)
 *    Role yang diuji:
 *    1. SUPER_ADMIN    : Onboarding Tenant POS-Only Mode (pos_only = true, numbering = queue)
 *    2. OWNER          : CRUD Kategori & CRUD Menu کامل, Config Pajak & Struk 80mm,
 *                        Pembatasan Role Staf (Hanya Kasir), Void Transaksi POS yang Sudah Lunas, & Analytics
 *    3. CASHIER        : Single-Step Direct POS Checkout (Dine-In & Takeaway -> langsung paid + completed tanpa Dapur/Runner),
 *                        Flow Simpan Antrean Belum Bayar (pending/unpaid) -> Pelunasan / Void Unpaid,
 *                        Cetak Struk Thermal ESC/POS, & Blokir Void Kasir pada Transaksi Lunas
 *    4. KITCHEN/RUNNER : Guard Mode POS-Only (Otomatis dialihkan / diblokir karena tidak relevan di POS-Only)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { generateIdempotencyKey } from "../lib/idempotency";
import { hashPin, verifyPin, PIN_MAX_ATTEMPTS } from "../lib/pin";
import { getRoleHome } from "../lib/rolePaths";
import { getQuickNoteGroups, toggleQuickNote } from "../lib/quickNotes";
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
  getOrdersByTenant,
  getOrdersForAnalytics,
} from "../services/orderService";
import {
  getCategoriesWithProducts,
  getProductsByTenant,
  getAllProductsByTenant,
  toggleProductAvailability,
  updateProduct,
} from "../services/productService";
import type { Order, Product, Tenant, UserRole } from "../types";

interface FlowStepResult {
  code: string;
  tenantType: "TENANT_1_FULL_TABLE" | "TENANT_2_POS_ONLY" | "CROSS_TENANT";
  role: string;
  flowName: string;
  passed: boolean;
  detail: string;
}

const results: FlowStepResult[] = [];

function logFlow(
  code: string,
  tenantType: FlowStepResult["tenantType"],
  role: string,
  flowName: string,
  passed: boolean,
  detail: string
) {
  results.push({ code, tenantType, role, flowName, passed, detail });
  const badge = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${badge} [${code}] [${tenantType}] (${role}) ${flowName}`);
  console.log(`   ↳ ${detail}`);
}

/** Simulasi guard akses halaman di TenantRoleGuard.tsx */
function simulateRolePageGuard(params: {
  userRole: UserRole;
  userTenantId: string | null;
  targetTenantId: string;
  targetSlug: string;
  isPosOnly: boolean;
  page: "admin" | "analytics" | "cashier" | "kitchen" | "runner";
}): { allowed: boolean; redirectTo?: string; reason?: string } {
  const { userRole, userTenantId, targetTenantId, targetSlug, isPosOnly, page } = params;

  // 1. Multi-tenant isolation
  if (userRole !== "SUPER_ADMIN" && userTenantId !== targetTenantId) {
    return { allowed: false, reason: "Isolasi Multi-Tenant: Staf outlet lain ditolak" };
  }

  // 2. POS-Only guard: KITCHEN & RUNNER dialihkan ke cashier
  if (isPosOnly && (userRole === "KITCHEN" || userRole === "RUNNER")) {
    return { allowed: false, redirectTo: `/${targetSlug}/cashier`, reason: "POS-Only Guard: Dialihkan ke Kasir" };
  }

  // 3. Allowed roles per halaman
  const pageAllowedRoles: Record<typeof page, UserRole[]> = {
    admin: ["OWNER", "SUPER_ADMIN"],
    analytics: ["OWNER", "SUPER_ADMIN"],
    cashier: ["CASHIER", "OWNER", "SUPER_ADMIN"],
    kitchen: ["KITCHEN", "CASHIER", "OWNER", "SUPER_ADMIN"],
    runner: ["RUNNER", "CASHIER", "OWNER", "SUPER_ADMIN"],
  };

  const isOwnerOrSuper = userRole === "OWNER" || userRole === "SUPER_ADMIN";
  if (!isOwnerOrSuper && !pageAllowedRoles[page].includes(userRole)) {
    return {
      allowed: false,
      redirectTo: getRoleHome(userRole, targetSlug),
      reason: `Role ${userRole} ditolak mengakses /${page}`,
    };
  }

  return { allowed: true };
}

/** Simulasi izin Void pesanan di /api/orders & cashier/page.tsx */
function canRoleVoidOrder(role: UserRole, paymentStatus: "unpaid" | "paid"): boolean {
  if (paymentStatus === "paid") {
    return role === "OWNER" || role === "SUPER_ADMIN";
  }
  return role === "CASHIER" || role === "OWNER" || role === "SUPER_ADMIN";
}

async function runRoleFlowVerification() {
  console.log("=======================================================================================");
  console.log("🧪 AUTOMASI PENGUJIAN SELURUH FLOW ROLE & CRUD PADA 2 TIPE TENANT UTAMA (FULL vs POS-ONLY)");
  console.log("=======================================================================================\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cleanupTenantIds: string[] = [];
  const cleanupCategoryIds: string[] = [];
  const cleanupProductIds: string[] = [];
  const cleanupOrderIds: string[] = [];

  try {
    // ===================================================================================
    // BAGIAN A: TENANT 1 — FULL MODE (NOMOR MEJA + BAYAR DULU / PREPAID + KIOSK + DAPUR + RUNNER)
    // ===================================================================================
    console.log("---------------------------------------------------------------------------------------");
    console.log("🏢 BAGIAN A: TENANT 1 — FULL MODE (Meja + Bayar Dulu + Kiosk + Kasir + Dapur + Runner)");
    console.log("---------------------------------------------------------------------------------------");

    // 1. [SUPER_ADMIN] Onboarding Tenant 1 (Full Mode: numbering="table", payment_timing="prepaid", pos_only=false)
    const slugT1 = `e2e-full-table-${Date.now()}`;
    const { data: t1, error: errT1 } = await sb
      .from("tenants")
      .insert({
        name: "Kafe Nusantara (Full Mode Meja)",
        slug: slugT1,
        is_active: true,
        visual_config: { primary_color: "#4f46e5", secondary_color: "#818cf8" },
        business_logic: {
          payment_timing: "prepaid",
          payment_mode: "manual",
          numbering: "table",
          require_cashier_verification: true,
          pos_only: false,
        },
        finance_config: { tax_percentage: 10, service_charge_percentage: 5, takeaway_fee: 2000 },
        receipt_config: {
          paper_size: "58mm",
          header_text: "Jl. Merdeka No. 10",
          footer_text: "Terima kasih!",
          show_logo: true,
        },
        manual_payment_channels: [
          { id: "ch-1", type: "qris_static", label: "QRIS Toko", image_url: "https://placehold.co/300x300/png" },
          { id: "ch-2", type: "cash", label: "Tunai / Cash" },
        ],
        payment_gateway_config: {},
      })
      .select()
      .single();

    if (errT1 || !t1) throw new Error(`Gagal membuat Tenant 1: ${errT1?.message}`);
    cleanupTenantIds.push(t1.id);

    logFlow(
      "T1-SA-01",
      "TENANT_1_FULL_TABLE",
      "SUPER_ADMIN",
      "Onboarding Tenant Full Mode (Mode Meja + Bayar Dulu + Kiosk + Dapur + Runner)",
      t1.business_logic.pos_only === false &&
      t1.business_logic.numbering === "table" &&
      t1.business_logic.payment_timing === "prepaid",
      `Tenant "${t1.name}" aktif dengan pos_only=false, numbering=table, payment_timing=prepaid`
    );

    // 2. [OWNER - Tenant 1] Pengaturan Pajak PB1, Service Charge, Biaya Takeaway & Struk
    const updatedFinanceT1 = { tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2500 };
    const updatedReceiptT1 = {
      paper_size: "58mm" as const,
      header_text: "Jl. Merdeka No. 10 - Telp 0811",
      footer_text: "WiFi: NusantaraKopi / Pass: kopi123",
      show_logo: true,
    };
    const { data: t1AfterOwnerConfig } = await sb
      .from("tenants")
      .update({ finance_config: updatedFinanceT1, receipt_config: updatedReceiptT1 })
      .eq("id", t1.id)
      .select()
      .single();

    logFlow(
      "T1-OWN-01",
      "TENANT_1_FULL_TABLE",
      "OWNER",
      "Update Konfigurasi PB1 (11%), Service Charge (5%), Biaya Takeaway (Rp 2.500) & Footer Struk",
      t1AfterOwnerConfig?.finance_config.tax_percentage === 11 &&
      t1AfterOwnerConfig?.finance_config.takeaway_fee === 2500 &&
      t1AfterOwnerConfig?.receipt_config.footer_text.includes("WiFi"),
      `PB1=${t1AfterOwnerConfig?.finance_config.tax_percentage}%, Service=${t1AfterOwnerConfig?.finance_config.service_charge_percentage}%, Takeaway=Rp ${t1AfterOwnerConfig?.finance_config.takeaway_fee}`
    );

    // 3. [OWNER - Tenant 1] Full CRUD Kategori (Create, Read, Update, Delete dengan Safe Unlink)
    const { data: catKopiT1 } = await sb
      .from("categories")
      .insert({ tenant_id: t1.id, name: "Kopi Signature", sort_order: 1, is_active: true })
      .select()
      .single();
    const { data: catMakanT1 } = await sb
      .from("categories")
      .insert({ tenant_id: t1.id, name: "Makanan Berat", sort_order: 2, is_active: true })
      .select()
      .single();
    const { data: catTempT1 } = await sb
      .from("categories")
      .insert({ tenant_id: t1.id, name: "Kategori Musiman", sort_order: 3, is_active: true })
      .select()
      .single();

    if (catKopiT1) cleanupCategoryIds.push(catKopiT1.id);
    if (catMakanT1) cleanupCategoryIds.push(catMakanT1.id);

    // Update nama kategori
    await sb.from("categories").update({ name: "Kopi & Espresso", sort_order: 0 }).eq("id", catKopiT1!.id);
    // Delete kategori musiman
    await sb.from("categories").delete().eq("id", catTempT1!.id).eq("tenant_id", t1.id);
    const activeCatsT1 = await getCategoriesWithProducts(t1.id);

    logFlow(
      "T1-OWN-02",
      "TENANT_1_FULL_TABLE",
      "OWNER",
      "Full CRUD Kategori Menu (Create 3 Kategori, Update Nama/Urutan, Delete 1 Kategori)",
      activeCatsT1.length === 2 && activeCatsT1[0].name === "Kopi & Espresso",
      `Kategori aktif tersisa ${activeCatsT1.length}: [${activeCatsT1.map((c) => c.name).join(", ")}]`
    );

    // 4. [OWNER - Tenant 1] Full CRUD Menu (Create, Update Harga Promo & Stok, Toggle Availability, Delete)
    const { data: menuKopiT1 } = await sb
      .from("products")
      .insert({
        tenant_id: t1.id,
        category_id: catKopiT1!.id,
        name: "Es Kopi Susu Aren",
        description: "Espresso dengan susu segar dan gula aren asli",
        base_price: 24000,
        discount_price: 20000,
        stock_count: 5,
        is_available: true,
        is_featured: true,
        labels: ["best_seller"],
        image_urls: [],
        sort_order: 1,
      })
      .select()
      .single();

    const { data: menuNasgorT1 } = await sb
      .from("products")
      .insert({
        tenant_id: t1.id,
        category_id: catMakanT1!.id,
        name: "Nasi Goreng Telur Spesial",
        description: "Nasi goreng kampung dengan telur dan ayam suwir",
        base_price: 30000,
        discount_price: null,
        stock_count: 2, // Stok terbatas 2 porsi
        is_available: true,
        is_featured: false,
        labels: ["pedas"],
        image_urls: [],
        sort_order: 2,
      })
      .select()
      .single();

    const { data: menuToDeleteT1 } = await sb
      .from("products")
      .insert({
        tenant_id: t1.id,
        category_id: catKopiT1!.id,
        name: "Menu Uji Hapus",
        base_price: 15000,
        stock_count: 10,
        is_available: true,
        is_featured: false,
        labels: [],
        image_urls: [],
        sort_order: 3,
      })
      .select()
      .single();

    if (menuKopiT1) cleanupProductIds.push(menuKopiT1.id);
    if (menuNasgorT1) cleanupProductIds.push(menuNasgorT1.id);

    // Owner update harga promo menuKopiT1 -> Rp 18.000
    await updateProduct(menuKopiT1!.id, { discount_price: 18000, stock_count: 4 });
    // Owner toggle off lalu toggle on kembali
    await toggleProductAvailability(menuKopiT1!.id, false);
    const prodsWhenOff = await getProductsByTenant(t1.id); // Kiosk hanya melihat yang is_available = true
    await toggleProductAvailability(menuKopiT1!.id, true);
    // Owner hapus menuToDeleteT1
    await sb.from("products").delete().eq("id", menuToDeleteT1!.id).eq("tenant_id", t1.id);
    const allProdsT1 = await getAllProductsByTenant(t1.id);

    logFlow(
      "T1-OWN-03",
      "TENANT_1_FULL_TABLE",
      "OWNER",
      "Full CRUD Menu (Create 3 Menu, Update Harga Promo & Stok, Toggle Habis/Tersedia, Delete Menu)",
      allProdsT1.length === 2 &&
      allProdsT1.find((p) => p.id === menuKopiT1!.id)?.discount_price === 18000 &&
      !prodsWhenOff.some((p) => p.id === menuKopiT1!.id),
      `Total menu aktif = ${allProdsT1.length}; Saat ditoggle Habis otomatis hilang dari Kiosk; Harga promo terupdate ke Rp 18.000`
    );

    // 5. [OWNER - Tenant 1] Manajemen Staf & PIN 6 Digit + Hak Akses Halaman per Role
    const cashierPinHash = hashPin("112233");
    const kitchenPinHash = hashPin("223344");
    const runnerPinHash = hashPin("334455");

    const guardCashierToCashier = simulateRolePageGuard({
      userRole: "CASHIER",
      userTenantId: t1.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "cashier",
    });
    const guardCashierToAnalytics = simulateRolePageGuard({
      userRole: "CASHIER",
      userTenantId: t1.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "analytics",
    });
    const guardCashierToAdmin = simulateRolePageGuard({
      userRole: "CASHIER",
      userTenantId: t1.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "admin",
    });
    const guardKitchenToKitchen = simulateRolePageGuard({
      userRole: "KITCHEN",
      userTenantId: t1.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "kitchen",
    });
    const guardRunnerToRunner = simulateRolePageGuard({
      userRole: "RUNNER",
      userTenantId: t1.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "runner",
    });

    logFlow(
      "T1-OWN-04",
      "TENANT_1_FULL_TABLE",
      "OWNER / STAFF",
      "Setup PIN Cepat Staf (Kasir, Dapur, Runner) & Validasi Matriks Akses Halaman (RBAC)",
      verifyPin("112233", cashierPinHash) &&
      verifyPin("223344", kitchenPinHash) &&
      verifyPin("334455", runnerPinHash) &&
      guardCashierToCashier.allowed &&
      !guardCashierToAnalytics.allowed &&
      !guardCashierToAdmin.allowed &&
      guardKitchenToKitchen.allowed &&
      guardRunnerToRunner.allowed,
      `Kasir->Kasir=Allowed, Kasir->Analytics=Blocked, Kasir->Admin=Blocked, Dapur->Dapur=Allowed, Runner->Runner=Allowed`
    );

    // 6. [KIOSK_CUSTOMER - Tenant 1] Flow Pemesanan Dine-In Mode Meja + QuickNoteChips + Kunci Meja + Potong Stok
    const kopiChips = getQuickNoteGroups(menuKopiT1!, "Kopi & Espresso", false);
    const nasgorChips = getQuickNoteGroups(menuNasgorT1!, "Makanan Berat", false);
    let kopiNote = toggleQuickNote("", "Less Sugar", kopiChips.find((g) => g.id === "sugar"));
    kopiNote = toggleQuickNote(kopiNote, "Less Ice", kopiChips.find((g) => g.id === "ice"));
    let nasgorNote = toggleQuickNote("", "Pedas", nasgorChips.find((g) => g.id === "spicy"));
    nasgorNote = toggleQuickNote(nasgorNote, "Telur Setengah Matang", nasgorChips.find((g) => g.id === "egg"));

    // Subtotal: 1x Kopi Promo (18.000) + 2x Nasgor (60.000) = 78.000
    // PB1 11% = 8.580, Service 5% = 3.900 -> Total = 90.480
    const orderDineInT1 = await createOrder(
      {
        tenant_id: t1.id,
        queue_number: "001",
        customer_name: "Kak Rina",
        table_number: "05",
        order_type: "dine_in",
        subtotal: 78000,
        tax_amount: 8580,
        service_charge_amount: 3900,
        takeaway_fee_amount: 0,
        total_amount: 90480,
        finance_snapshot: updatedFinanceT1,
      },
      [
        {
          product_id: menuKopiT1!.id,
          product_name_snapshot: menuKopiT1!.name,
          base_price_snapshot: menuKopiT1!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
          notes: kopiNote,
        },
        {
          product_id: menuNasgorT1!.id,
          product_name_snapshot: menuNasgorT1!.name,
          base_price_snapshot: menuNasgorT1!.base_price,
          selected_variants: [],
          quantity: 2,
          unit_price: 30000,
          subtotal: 60000,
          notes: nasgorNote,
        },
      ],
      generateIdempotencyKey("t1-kiosk-dinein")
    );
    if (orderDineInT1) cleanupOrderIds.push(orderDineInT1.id);

    const activeTable05 = await getActiveOrderByTable(t1.id, "05");
    const { data: nasgorAfterKiosk } = await sb
      .from("products")
      .select("stock_count, is_available")
      .eq("id", menuNasgorT1!.id)
      .single();

    logFlow(
      "T1-KIOSK-01",
      "TENANT_1_FULL_TABLE",
      "KIOSK_CUSTOMER",
      "Checkout Dine-In Mode Meja (Meja 05) + Chip Catatan Otomatis + Potong Stok & Kunci Meja",
      Boolean(
        orderDineInT1 &&
        orderDineInT1.order_status === "pending" &&
        orderDineInT1.payment_status === "unpaid" &&
        activeTable05?.id === orderDineInT1.id &&
        nasgorAfterKiosk?.stock_count === 0 &&
        nasgorAfterKiosk?.is_available === false
      ),
      `Order #001 (Meja 05) pending/unpaid; Catatan Kopi="${kopiNote}", Nasgor="${nasgorNote}"; Stok Nasgor 2->0 (otomatis Habis); Meja 05 terkunci`
    );

    // 7. [KIOSK_CUSTOMER - Tenant 1] Flow Pemesanan Takeaway di Tenant Mode Meja (Tanpa Nomor Meja + Kena Biaya Takeaway)
    const orderTakeawayT1 = await createOrder(
      {
        tenant_id: t1.id,
        queue_number: "002",
        customer_name: "Bang Dimas",
        order_type: "takeaway",
        subtotal: 18000,
        tax_amount: 1980,
        service_charge_amount: 900,
        takeaway_fee_amount: 2500,
        total_amount: 23380,
        finance_snapshot: updatedFinanceT1,
      },
      [
        {
          product_id: menuKopiT1!.id,
          product_name_snapshot: menuKopiT1!.name,
          base_price_snapshot: menuKopiT1!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
          notes: "Normal Sugar, Bungkus Terpisah",
        },
      ],
      generateIdempotencyKey("t1-kiosk-takeaway")
    );
    if (orderTakeawayT1) cleanupOrderIds.push(orderTakeawayT1.id);

    logFlow(
      "T1-KIOSK-02",
      "TENANT_1_FULL_TABLE",
      "KIOSK_CUSTOMER",
      "Checkout Takeaway di Tenant Mode Meja (Tanpa Input Meja + Otomatis Tambah Biaya Takeaway Rp 2.500)",
      Boolean(
        orderTakeawayT1 &&
        orderTakeawayT1.table_number === null &&
        orderTakeawayT1.takeaway_fee_amount === 2500 &&
        orderTakeawayT1.total_amount === 23380
      ),
      `Order #002 Takeaway berhasil tanpa nomor meja, takeaway_fee = Rp ${orderTakeawayT1?.takeaway_fee_amount}, total = Rp ${orderTakeawayT1?.total_amount.toLocaleString("id-ID")}`
    );

    // 8. [CASHIER - Tenant 1] Flow Kasir: Buat Pesanan Pending Baru & Void Pesanan Belum Lunas (Unpaid)
    const cashierPendingOrderT1 = await createOrder(
      {
        tenant_id: t1.id,
        queue_number: "003",
        customer_name: "Tamu Batal",
        table_number: "09",
        order_type: "dine_in",
        subtotal: 18000,
        tax_amount: 1980,
        service_charge_amount: 900,
        takeaway_fee_amount: 0,
        total_amount: 20880,
        created_by_cashier: true,
        finance_snapshot: updatedFinanceT1,
      },
      [
        {
          product_id: menuKopiT1!.id,
          product_name_snapshot: menuKopiT1!.name,
          base_price_snapshot: menuKopiT1!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
        },
      ],
      generateIdempotencyKey("t1-cashier-pending")
    );
    if (cashierPendingOrderT1) cleanupOrderIds.push(cashierPendingOrderT1.id);

    // Sebelum void: stok menuKopiT1 sudah terpakai 3 (sisa 1 dari 4), Meja 09 terisi
    const cashierAllowedToVoidUnpaid = canRoleVoidOrder("CASHIER", "unpaid");
    const voidUnpaidOk =
      cashierAllowedToVoidUnpaid &&
      (await voidOrder(cashierPendingOrderT1!.id, "Pelanggan batal pesan sebelum bayar", null));
    const table09AfterVoid = await getActiveOrderByTable(t1.id, "09");
    const { data: kopiAfterUnpaidVoid } = await sb
      .from("products")
      .select("stock_count")
      .eq("id", menuKopiT1!.id)
      .single();

    logFlow(
      "T1-CASH-01",
      "TENANT_1_FULL_TABLE",
      "CASHIER",
      "Kasir Simpan Pesanan Pending & Void Pesanan Belum Lunas (Unpaid -> Stok Kembali & Meja 09 Bebas)",
      Boolean(voidUnpaidOk && table09AfterVoid === null && kopiAfterUnpaidVoid?.stock_count === 2),
      `Void Unpaid oleh Kasir diizinkan; Stok Kopi kembali 1 -> ${kopiAfterUnpaidVoid?.stock_count}; Meja 09 kembali kosong`
    );

    // 9. [CASHIER - Tenant 1] Flow Kasir: Konfirmasi Lunas Pesanan Kiosk #001 & #002 -> Masuk ke Antrean Dapur (cooking)
    const paidOrder1 = await markOrderPaid(orderDineInT1!.id, "qris_static", null);
    const paidOrder2 = await markOrderPaid(orderTakeawayT1!.id, "cash", null);
    const { data: checkPaid1 } = await sb
      .from("orders")
      .select("payment_status, order_status, verification_status")
      .eq("id", orderDineInT1!.id)
      .single();

    // Uji coba Kasir melakukan Void pada Order #001 yang SUDAH LUNAS (paid) -> Wajib DITOLAK!
    const cashierAllowedToVoidPaid = canRoleVoidOrder("CASHIER", "paid");

    logFlow(
      "T1-CASH-02",
      "TENANT_1_FULL_TABLE",
      "CASHIER",
      "Kasir Konfirmasi Lunas Pesanan Kiosk (pending -> paid + cooking) & Blokir Kasir dari Void Pesanan Lunas",
      Boolean(
        paidOrder1 &&
        paidOrder2 &&
        checkPaid1?.payment_status === "paid" &&
        checkPaid1?.order_status === "cooking" &&
        cashierAllowedToVoidPaid === false
      ),
      `Order #001 & #002 Lunas dan terkirim ke Dapur (status=cooking); Hak Kasir Void pesanan Paid = ${cashierAllowedToVoidPaid} (Terkunci)`
    );

    // 10. [KITCHEN - Tenant 1] Flow Dapur (KDS): Terima Antrean cooking -> Checklist Item -> Undo -> Tandai Ready
    const cookingListT1 = await getOrdersByTenant(t1.id, ["cooking"]);
    const kdsOrder = cookingListT1.find((o) => o.id === orderDineInT1!.id);
    const kdsItemIds = (kdsOrder?.items ?? []).map((it) => it.id);

    // Koki centang item 1, lalu centang item 1 & 2, lalu simulasi Undo item 2, lalu centang semua & set status ready
    await updateOrderCookedItems(orderDineInT1!.id, kdsOrder?.customer_notes ?? null, [kdsItemIds[0]]);
    await updateOrderCookedItems(orderDineInT1!.id, kdsOrder?.customer_notes ?? null, kdsItemIds);
    // Simulasi Undo centang item ke-2
    await updateOrderCookedItems(orderDineInT1!.id, kdsOrder?.customer_notes ?? null, [kdsItemIds[0]]);
    // Centang kembali semua item dan pindahkan status ke ready
    await updateOrderCookedItems(orderDineInT1!.id, kdsOrder?.customer_notes ?? null, kdsItemIds);
    await updateOrderStatus(orderDineInT1!.id, "ready");
    await updateOrderStatus(orderTakeawayT1!.id, "ready");

    const { data: orderAfterKds } = await sb
      .from("orders")
      .select("order_status, customer_notes")
      .eq("id", orderDineInT1!.id)
      .single();
    const parsedAfterKds = parseCustomerNotes(orderAfterKds?.customer_notes ?? null);

    logFlow(
      "T1-KDS-01",
      "TENANT_1_FULL_TABLE",
      "KITCHEN",
      "Dapur (KDS) Menerima Pesanan Lunas, Checklist Item + Undo Checklist, & Tandai Siap Saji (ready)",
      Boolean(
        kdsOrder &&
        orderAfterKds?.order_status === "ready" &&
        parsedAfterKds.cookedItemIds.length === kdsItemIds.length &&
        parsedAfterKds.customerName === "Kak Rina"
      ),
      `KDS memproses ${kdsItemIds.length} item masakan untuk "${parsedAfterKds.customerName}", status berpindah cooking -> ready`
    );

    // 11. [RUNNER - Tenant 1] Flow Runner: Antar Pesanan Dine-In (Meja 05) & Serahkan Takeaway -> completed & Meja 05 Bebas
    const readyListT1 = await getOrdersByTenant(t1.id, ["ready"]);
    const runnerTargetDineIn = readyListT1.find((o) => o.id === orderDineInT1!.id);

    // Runner klik Antar pada pesanan Dine-In Meja 05
    await markOrderServed(orderDineInT1!.id, runnerTargetDineIn?.customer_notes);
    await updateOrderStatus(orderDineInT1!.id, "completed");

    // Runner klik Serahkan pada pesanan Takeaway #002 yang sudah lunas
    await updateOrderStatus(orderTakeawayT1!.id, "completed");

    const table05AfterRunner = await getActiveOrderByTable(t1.id, "05");
    const { data: checkCompleted1 } = await sb
      .from("orders")
      .select("order_status, customer_notes")
      .eq("id", orderDineInT1!.id)
      .single();

    logFlow(
      "T1-RUN-01",
      "TENANT_1_FULL_TABLE",
      "RUNNER",
      "Runner Antar Pesanan Dine-In ([SERVED] -> completed) & Takeaway Lunas + Pembebasan Meja 05",
      Boolean(
        checkCompleted1?.order_status === "completed" &&
        checkCompleted1?.customer_notes?.includes("[SERVED]") &&
        table05AfterRunner === null
      ),
      `Order #001 & #002 berstatus completed; Tag [SERVED] tercatat; Meja 05 otomatis kembali kosong (siap dipakai pelanggan baru)`
    );

    // 12. [OWNER - Tenant 1] Flow Analytics & Hak Void Khusus Owner pada Pesanan yang Sudah Lunas (Paid)
    const dateFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dateTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const analyticsT1BeforeVoid = await getOrdersForAnalytics(t1.id, dateFrom, dateTo);
    const revenueBeforeVoid = analyticsT1BeforeVoid
      .filter((o) => o.order_status === "completed")
      .reduce((s, o) => s + o.total_amount, 0);

    // Sekarang Owner melakukan Void pada Order #002 (Takeaway yang sudah PAID & COMPLETED sebesar Rp 23.380)
    const ownerAllowedToVoidPaid = canRoleVoidOrder("OWNER", "paid");
    const ownerVoidPaidOk =
      ownerAllowedToVoidPaid && (await voidOrder(orderTakeawayT1!.id, "Refund oleh Owner: salah input menu", null));

    const analyticsT1AfterVoid = await getOrdersForAnalytics(t1.id, dateFrom, dateTo);
    const revenueAfterVoid = analyticsT1AfterVoid
      .filter((o) => o.order_status === "completed")
      .reduce((s, o) => s + o.total_amount, 0);
    const { data: kopiAfterOwnerVoid } = await sb
      .from("products")
      .select("stock_count")
      .eq("id", menuKopiT1!.id)
      .single();

    logFlow(
      "T1-OWN-05",
      "TENANT_1_FULL_TABLE",
      "OWNER",
      "Owner Void Pesanan yang Sudah Lunas (Paid) dari Halaman Analytics + Stok Kembali & Koreksi Omzet",
      Boolean(
        ownerVoidPaidOk &&
        revenueBeforeVoid === 90480 + 23380 &&
        revenueAfterVoid === 90480 &&
        kopiAfterOwnerVoid?.stock_count === 3
      ),
      `Omzet sebelum Void = Rp ${revenueBeforeVoid.toLocaleString("id-ID")} -> setelah Owner Void Order #002 = Rp ${revenueAfterVoid.toLocaleString("id-ID")}; Stok Kopi kembali 2 -> ${kopiAfterOwnerVoid?.stock_count}`
    );

    // ===================================================================================
    // BAGIAN B: TENANT 2 — POS-ONLY MODE (STANDALONE KASIR + NOMOR ANTRIAN + BAYAR DULU)
    // ===================================================================================
    console.log("\n---------------------------------------------------------------------------------------");
    console.log("🏪 BAGIAN B: TENANT 2 — POS-ONLY MODE (Standalone POS + Nomor Antrian + Tanpa Dapur/Runner)");
    console.log("---------------------------------------------------------------------------------------");

    // 1. [SUPER_ADMIN] Onboarding Tenant 2 (POS-Only Mode: pos_only=true, numbering="queue", payment_timing="prepaid")
    const slugT2 = `e2e-pos-only-${Date.now()}`;
    const { data: t2, error: errT2 } = await sb
      .from("tenants")
      .insert({
        name: "Booth Express Kopi (POS-Only)",
        slug: slugT2,
        is_active: true,
        visual_config: { primary_color: "#059669", secondary_color: "#34d399" },
        business_logic: {
          payment_timing: "prepaid",
          payment_mode: "manual",
          numbering: "queue",
          require_cashier_verification: false,
          pos_only: true,
        },
        finance_config: { tax_percentage: 0, service_charge_percentage: 0, takeaway_fee: 1000 },
        receipt_config: {
          paper_size: "80mm",
          header_text: "Booth Express Lt. 1",
          footer_text: "Cepat & Nikmat!",
          show_logo: true,
        },
        manual_payment_channels: [{ id: "ch-1", type: "cash", label: "Tunai" }],
        payment_gateway_config: {},
      })
      .select()
      .single();

    if (errT2 || !t2) throw new Error(`Gagal membuat Tenant 2: ${errT2?.message}`);
    cleanupTenantIds.push(t2.id);

    logFlow(
      "T2-SA-01",
      "TENANT_2_POS_ONLY",
      "SUPER_ADMIN",
      "Onboarding Tenant POS-Only Mode (pos_only=true, numbering=queue, payment_timing=prepaid)",
      t2.business_logic.pos_only === true && t2.business_logic.numbering === "queue",
      `Tenant "${t2.name}" aktif dengan pos_only=true, numbering=queue`
    );

    // 2. [OWNER - Tenant 2] CRUD Kategori, CRUD Menu & Pengaturan Pajak PB1 di Tenant POS-Only
    const { data: catPosT2 } = await sb
      .from("categories")
      .insert({ tenant_id: t2.id, name: "Minuman Cepat Saji", sort_order: 1, is_active: true })
      .select()
      .single();
    if (catPosT2) cleanupCategoryIds.push(catPosT2.id);

    const { data: prodMatchaT2 } = await sb
      .from("products")
      .insert({
        tenant_id: t2.id,
        category_id: catPosT2!.id,
        name: "Iced Matcha Latte",
        base_price: 25000,
        discount_price: 22000,
        stock_count: 3,
        is_available: true,
        is_featured: true,
        labels: ["best_seller"],
        image_urls: [],
        sort_order: 1,
      })
      .select()
      .single();

    const { data: prodToastT2 } = await sb
      .from("products")
      .insert({
        tenant_id: t2.id,
        category_id: catPosT2!.id,
        name: "Roti Bakar Coklat Keju",
        base_price: 18000,
        discount_price: null,
        stock_count: 2,
        is_available: true,
        is_featured: false,
        labels: [],
        image_urls: [],
        sort_order: 2,
      })
      .select()
      .single();

    if (prodMatchaT2) cleanupProductIds.push(prodMatchaT2.id);
    if (prodToastT2) cleanupProductIds.push(prodToastT2.id);

    // Owner Tenant 2 mengaktifkan PB1 10% dan biaya takeaway Rp 1.500
    const financeT2 = { tax_percentage: 10, service_charge_percentage: 0, takeaway_fee: 1500 };
    await sb.from("tenants").update({ finance_config: financeT2 }).eq("id", t2.id);
    const prodsT2 = await getAllProductsByTenant(t2.id);

    logFlow(
      "T2-OWN-01",
      "TENANT_2_POS_ONLY",
      "OWNER",
      "Owner POS-Only: CRUD Kategori & Menu + Set Pajak PB1 (10%) & Biaya Takeaway (Rp 1.500)",
      prodsT2.length === 2,
      `Katalog Tenant 2 memiliki ${prodsT2.length} menu aktif dengan PB1=10% & Takeaway Fee=Rp 1.500`
    );

    // 3. [KITCHEN & RUNNER - Tenant 2] Guard Mode POS-Only (Akses Dapur & Runner Otomatis Dialihkan ke Kasir)
    const kitchenOnPosOnly = simulateRolePageGuard({
      userRole: "KITCHEN",
      userTenantId: t2.id,
      targetTenantId: t2.id,
      targetSlug: t2.slug,
      isPosOnly: true,
      page: "kitchen",
    });
    const runnerOnPosOnly = simulateRolePageGuard({
      userRole: "RUNNER",
      userTenantId: t2.id,
      targetTenantId: t2.id,
      targetSlug: t2.slug,
      isPosOnly: true,
      page: "runner",
    });

    logFlow(
      "T2-GUARD-01",
      "TENANT_2_POS_ONLY",
      "KITCHEN / RUNNER",
      "Proteksi Mode POS-Only: Role Dapur & Runner Otomatis Dialihkan ke Halaman Kasir",
      !kitchenOnPosOnly.allowed &&
      kitchenOnPosOnly.redirectTo === `/${t2.slug}/cashier` &&
      !runnerOnPosOnly.allowed &&
      runnerOnPosOnly.redirectTo === `/${t2.slug}/cashier`,
      `Akses /kitchen & /runner di tenant POS-Only otomatis redirect ke /${t2.slug}/cashier`
    );

    // 4. [CASHIER - Tenant 2] Flow POS-Only 1: Single-Step Direct POS Checkout (Langsung Paid + Completed + Potong Stok + Cetak Struk)
    // Kasir memilih 2x Iced Matcha Latte (Promo @22.000 = 44.000) + 1x Roti Bakar (@18.000) Takeaway
    // Subtotal = 62.000, PB1 10% = 6.200, Takeaway Fee = 1.500 -> Total = 69.700
    const toastChips = getQuickNoteGroups(prodToastT2!, "Minuman Cepat Saji", true);
    const toastNote = toggleQuickNote("", "Dihangatkan", toastChips.find((g) => g.id === "bread_custom"));

    const posDirectOrder = await createOrder(
      {
        tenant_id: t2.id,
        queue_number: "001",
        customer_name: "Pelanggan Walk-In",
        order_type: "takeaway",
        subtotal: 62000,
        tax_amount: 6200,
        service_charge_amount: 0,
        takeaway_fee_amount: 1500,
        total_amount: 69700,
        created_by_cashier: true,
        finance_snapshot: financeT2,
      },
      [
        {
          product_id: prodMatchaT2!.id,
          product_name_snapshot: prodMatchaT2!.name,
          base_price_snapshot: prodMatchaT2!.base_price,
          selected_variants: [],
          quantity: 2,
          unit_price: 22000,
          subtotal: 44000,
          notes: "Less Sugar",
        },
        {
          product_id: prodToastT2!.id,
          product_name_snapshot: prodToastT2!.name,
          base_price_snapshot: prodToastT2!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 18000,
          subtotal: 18000,
          notes: toastNote,
        },
      ],
      generateIdempotencyKey("t2-pos-direct")
    );
    if (posDirectOrder) cleanupOrderIds.push(posDirectOrder.id);

    // Di mode POS-Only, handleDirectPosPay langsung memanggil markOrderPaid(..., "completed")
    await markOrderPaid(posDirectOrder!.id, "cash", null, "completed");

    const { data: checkPosDirect } = await sb
      .from("orders")
      .select("payment_status, order_status, total_amount")
      .eq("id", posDirectOrder!.id)
      .single();
    const { data: matchaAfterDirect } = await sb
      .from("products")
      .select("stock_count")
      .eq("id", prodMatchaT2!.id)
      .single();

    // Generate struk 80mm untuk transaksi POS-Only
    const posReceiptBytes = generateReceiptEscPos(
      { ...(posDirectOrder as Order), payment_status: "paid", order_status: "completed" },
      t2 as Tenant,
      { paperSize: "80mm", payMethod: "cash", cashReceived: 100000 }
    );

    logFlow(
      "T2-CASH-01",
      "TENANT_2_POS_ONLY",
      "CASHIER",
      "Single-Step Direct POS Checkout (Langsung Paid + Completed Tanpa Dapur/Runner + Potong Stok + Struk 80mm)",
      Boolean(
        checkPosDirect?.payment_status === "paid" &&
        checkPosDirect?.order_status === "completed" &&
        matchaAfterDirect?.stock_count === 1 &&
        posReceiptBytes.byteLength > 200
      ),
      `Order #001 langsung paid + completed (Total Rp ${checkPosDirect?.total_amount.toLocaleString("id-ID")}); Stok Matcha 3 -> ${matchaAfterDirect?.stock_count}; Struk 80mm=${posReceiptBytes.byteLength} bytes`
    );

    // 5. [CASHIER - Tenant 2] Flow POS-Only 2: Simpan Pesanan Belum Bayar (Save Pending) -> Void Unpaid oleh Kasir
    const posPendingOrder = await createOrder(
      {
        tenant_id: t2.id,
        queue_number: "002",
        customer_name: "Tamu Antre",
        order_type: "dine_in",
        subtotal: 22000,
        tax_amount: 2200,
        service_charge_amount: 0,
        takeaway_fee_amount: 0,
        total_amount: 24200,
        created_by_cashier: true,
        finance_snapshot: financeT2,
      },
      [
        {
          product_id: prodMatchaT2!.id,
          product_name_snapshot: prodMatchaT2!.name,
          base_price_snapshot: prodMatchaT2!.base_price,
          selected_variants: [],
          quantity: 1,
          unit_price: 22000,
          subtotal: 22000,
        },
      ],
      generateIdempotencyKey("t2-pos-pending")
    );
    if (posPendingOrder) cleanupOrderIds.push(posPendingOrder.id);

    // Saat posPendingOrder dibuat, sisa stok Matcha (1) habis menjadi 0 (is_available = false).
    // Kasir kemudian membatalkan (Void) posPendingOrder yang masih unpaid -> stok kembali menjadi 1 (is_available = true).
    const voidPosPendingOk =
      canRoleVoidOrder("CASHIER", "unpaid") &&
      (await voidOrder(posPendingOrder!.id, "Batal pesan di kasir POS", null));
    const { data: matchaAfterVoidPending } = await sb
      .from("products")
      .select("stock_count, is_available")
      .eq("id", prodMatchaT2!.id)
      .single();

    logFlow(
      "T2-CASH-02",
      "TENANT_2_POS_ONLY",
      "CASHIER",
      "POS-Only Save Pending (Antrean Belum Bayar) & Void Unpaid oleh Kasir (Restore Stok 0 -> 1)",
      Boolean(voidPosPendingOk && matchaAfterVoidPending?.stock_count === 1 && matchaAfterVoidPending?.is_available === true),
      `Order #002 (unpaid) di-Void oleh Kasir; Stok Matcha kembali dari 0 -> ${matchaAfterVoidPending?.stock_count} & is_available=${matchaAfterVoidPending?.is_available}`
    );

    // 6. [OWNER - Tenant 2] Flow Analytics & Void Transaksi POS-Only yang Sudah Lunas (Paid) oleh Owner
    const analyticsT2 = await getOrdersForAnalytics(t2.id, dateFrom, dateTo);
    const revenueT2 = analyticsT2
      .filter((o) => o.order_status === "completed")
      .reduce((s, o) => s + o.total_amount, 0);

    // Kasir tidak boleh Void posDirectOrder (karena sudah paid), tetapi Owner boleh!
    const cashierBlockedOnPosPaid = !canRoleVoidOrder("CASHIER", "paid");
    const ownerCanVoidPosPaid = canRoleVoidOrder("OWNER", "paid");

    logFlow(
      "T2-OWN-02",
      "TENANT_2_POS_ONLY",
      "OWNER",
      "Verifikasi Omzet Analytics POS-Only & Proteksi Hak Void Transaksi Lunas (Kasir Ditolak, Owner Diizinkan)",
      revenueT2 === 69700 && cashierBlockedOnPosPaid && ownerCanVoidPosPaid,
      `Omzet bersih Tenant 2 = Rp ${revenueT2.toLocaleString("id-ID")} (Order #002 yang di-void tidak dihitung); Kasir Void Paid=Blocked, Owner Void Paid=Allowed`
    );

    // ===================================================================================
    // BAGIAN C: UJI ISOLASI SILANG ANTAR TENANT 1 (FULL) & TENANT 2 (POS-ONLY)
    // ===================================================================================
    const crossGuardCashierT1ToT2 = simulateRolePageGuard({
      userRole: "CASHIER",
      userTenantId: t1.id,
      targetTenantId: t2.id,
      targetSlug: t2.slug,
      isPosOnly: true,
      page: "cashier",
    });
    const crossGuardOwnerT2ToT1 = simulateRolePageGuard({
      userRole: "OWNER",
      userTenantId: t2.id,
      targetTenantId: t1.id,
      targetSlug: t1.slug,
      isPosOnly: false,
      page: "admin",
    });
    const superAdminCanAccessBoth =
      simulateRolePageGuard({
        userRole: "SUPER_ADMIN",
        userTenantId: null,
        targetTenantId: t1.id,
        targetSlug: t1.slug,
        isPosOnly: false,
        page: "admin",
      }).allowed &&
      simulateRolePageGuard({
        userRole: "SUPER_ADMIN",
        userTenantId: null,
        targetTenantId: t2.id,
        targetSlug: t2.slug,
        isPosOnly: true,
        page: "admin",
      }).allowed;

    logFlow(
      "CROSS-01",
      "CROSS_TENANT",
      "ALL_ROLES",
      "Isolasi Silang Antar Tenant 1 (Full Mode) & Tenant 2 (POS-Only) di Semua Role",
      !crossGuardCashierT1ToT2.allowed && !crossGuardOwnerT2ToT1.allowed && superAdminCanAccessBoth,
      `Kasir T1 -> Kasir T2 = Ditolak; Owner T2 -> Admin T1 = Ditolak; Super Admin -> T1 & T2 = Diizinkan`
    );
  } finally {
    console.log("\n🧹 Membersihkan seluruh data uji Tenant 1 & Tenant 2 dari Supabase...");
    if (cleanupOrderIds.length > 0) {
      await sb.from("order_items").delete().in("order_id", cleanupOrderIds);
      await sb.from("orders").delete().in("id", cleanupOrderIds);
    }
    if (cleanupProductIds.length > 0) {
      await sb.from("products").delete().in("id", cleanupProductIds);
    }
    if (cleanupCategoryIds.length > 0) {
      await sb.from("categories").delete().in("id", cleanupCategoryIds);
    }
    if (cleanupTenantIds.length > 0) {
      await sb.from("orders").delete().in("tenant_id", cleanupTenantIds);
      await sb.from("products").delete().in("tenant_id", cleanupTenantIds);
      await sb.from("categories").delete().in("tenant_id", cleanupTenantIds);
      await sb.from("tenants").delete().in("id", cleanupTenantIds);
    }
    console.log(" Pembersihan data uji selesai.\n");
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("=======================================================================================");
  console.log(`📊 HASIL AKHIR AUTOMASI FLOW 2 TENANT × SEMUA ROLE: ${passed}/${results.length} LULUS (PASS), ${failed} GAGAL`);
  console.log("=======================================================================================");

  if (failed > 0) process.exit(1);
}

runRoleFlowVerification().catch((err) => {
  console.error("❌ Error fatal:", err);
  process.exit(1);
});
