import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_SLUG = "kafe-asik";

async function clean() {
    console.log("🧹 Cleaning existing seed data...");
    await supabase.from("order_items").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("orders").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("product_variant_options").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("product_variant_groups").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("products").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("categories").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("tables").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("profiles").delete().eq("tenant_id", TENANT_ID);
    await supabase.from("tenants").delete().eq("id", TENANT_ID);
    console.log("✅ Clean done");
}

async function seedTenant() {
    const { error } = await supabase.from("tenants").insert({
        id: TENANT_ID,
        name: "Kafe Asik",
        slug: TENANT_SLUG,
        subtitle: "Tempat nongkrong paling asik di kota",
        description: "Kafe modern dengan suasana nyaman, kopi premium, dan menu variatif.",
        logo_url: "https://placehold.co/200x200/f59e0b/white?text=KA",
        visual_config: { primary_color: "#f59e0b", secondary_color: "#fbbf24" },
        business_logic: {
            payment_timing: "prepaid",
            payment_mode: "manual",
            numbering: "queue",
            require_cashier_verification: true,
        },
        finance_config: { tax_percentage: 11, service_charge_percentage: 5, takeaway_fee: 2000 },
        payment_gateway_config: {},
        manual_payment_channels: [
            {
                id: "ch-001",
                type: "qris_static",
                label: "QRIS / E-Wallet",
                image_url: "https://placehold.co/300x300/f59e0b/white?text=QRIS",
                instructions: "Scan QR lalu tunjukkan bukti ke kasir",
            },
            {
                id: "ch-002",
                type: "bank_transfer",
                label: "Transfer BCA",
                bank_name: "BCA",
                account_number: "8877665544",
                account_name: "Kafe Asik",
                instructions: "Transfer ke BCA di atas, lalu tunjukkan bukti ke kasir",
            },
            {
                id: "ch-003",
                type: "cash",
                label: "Tunai / Cash",
                instructions: "Bayar langsung ke kasir",
            },
        ],
        receipt_config: {
            header_text: "Kafe Asik\nJl. Merdeka No. 88\nTelp: 081234567890",
            footer_text: "Terima kasih sudah berkunjung! IG: @kafeasik",
            show_logo: true,
        },
    });
    if (error) throw new Error(`Tenant error: ${error.message}`);
    console.log(`✅ Tenant: ${TENANT_SLUG}`);
}

async function seedCategories() {
    const cats = [
        { id: "aaaaaaaa-0001-0000-0000-000000000001", tenant_id: TENANT_ID, name: "Kopi Panas", sort_order: 1 },
        { id: "aaaaaaaa-0001-0000-0000-000000000002", tenant_id: TENANT_ID, name: "Kopi Dingin", sort_order: 2 },
        { id: "aaaaaaaa-0001-0000-0000-000000000003", tenant_id: TENANT_ID, name: "Minuman Non-Kopi", sort_order: 3 },
        { id: "aaaaaaaa-0001-0000-0000-000000000004", tenant_id: TENANT_ID, name: "Makanan", sort_order: 4 },
        { id: "aaaaaaaa-0001-0000-0000-000000000005", tenant_id: TENANT_ID, name: "Snack & Dessert", sort_order: 5 },
    ];
    const { error } = await supabase.from("categories").insert(cats);
    if (error) throw new Error(`Categories error: ${error.message}`);
    console.log(`✅ Categories: ${cats.length}`);
    return cats;
}

async function seedProducts(cats: { id: string; name: string }[]) {
    const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));
    const T = TENANT_ID;
    const pid = (n: number) => `aaaaaaaa-0002-0000-0000-${String(n).padStart(12, "0")}`;

    const products = [
        { id: pid(1), tenant_id: T, category_id: catMap["Kopi Panas"], name: "Espresso", description: "Shot espresso murni, intense dan bold", base_price: 18000, labels: ["best_seller"], sort_order: 1, is_featured: true, image_urls: ["https://placehold.co/400x300/f59e0b/white?text=Espresso"] },
        { id: pid(2), tenant_id: T, category_id: catMap["Kopi Panas"], name: "Cappuccino", description: "Espresso dengan foam susu creamy hangat", base_price: 28000, labels: [], sort_order: 2, is_featured: false, image_urls: ["https://placehold.co/400x300/d97706/white?text=Cappuccino"] },
        { id: pid(3), tenant_id: T, category_id: catMap["Kopi Panas"], name: "Latte", description: "Espresso dengan susu hangat lembut", base_price: 30000, labels: ["recommended"], sort_order: 3, is_featured: false, image_urls: ["https://placehold.co/400x300/b45309/white?text=Latte"] },
        { id: pid(4), tenant_id: T, category_id: catMap["Kopi Dingin"], name: "Es Kopi Susu", description: "Kopi susu dingin kekinian, segar dan creamy", base_price: 25000, labels: ["best_seller", "new"], sort_order: 1, is_featured: true, image_urls: ["https://placehold.co/400x300/f59e0b/white?text=Es+Kopi+Susu"] },
        { id: pid(5), tenant_id: T, category_id: catMap["Kopi Dingin"], name: "Cold Brew", description: "Kopi diseduh dingin selama 12 jam, smooth dan low-acid", base_price: 32000, labels: ["new"], sort_order: 2, is_featured: false, image_urls: ["https://placehold.co/400x300/78350f/white?text=Cold+Brew"] },
        { id: pid(6), tenant_id: T, category_id: catMap["Kopi Dingin"], name: "Iced Americano", description: "Espresso dengan air dan es batu, refreshing", base_price: 22000, labels: [], sort_order: 3, is_featured: false, image_urls: ["https://placehold.co/400x300/92400e/white?text=Iced+Americano"] },
        { id: pid(7), tenant_id: T, category_id: catMap["Minuman Non-Kopi"], name: "Matcha Latte", description: "Matcha Jepang premium dengan susu segar", base_price: 30000, labels: ["recommended"], sort_order: 1, is_featured: true, image_urls: ["https://placehold.co/400x300/16a34a/white?text=Matcha"] },
        { id: pid(8), tenant_id: T, category_id: catMap["Minuman Non-Kopi"], name: "Chocolate Milk", description: "Cokelat premium dengan susu full cream", base_price: 28000, labels: [], sort_order: 2, is_featured: false, image_urls: ["https://placehold.co/400x300/92400e/white?text=Choco"] },
        { id: pid(9), tenant_id: T, category_id: catMap["Minuman Non-Kopi"], name: "Teh Tarik", description: "Teh susu khas dengan teknik tarik tradisional", base_price: 20000, labels: [], sort_order: 3, is_featured: false, image_urls: ["https://placehold.co/400x300/d97706/white?text=Teh+Tarik"] },
        { id: pid(10), tenant_id: T, category_id: catMap["Makanan"], name: "Nasi Goreng Kafe", description: "Nasi goreng spesial dengan telur mata sapi dan kerupuk", base_price: 38000, labels: ["best_seller"], sort_order: 1, is_featured: true, image_urls: ["https://placehold.co/400x300/f59e0b/white?text=Nasi+Goreng"] },
        { id: pid(11), tenant_id: T, category_id: catMap["Makanan"], name: "Toast Avokado", description: "Roti panggang dengan avokado segar, telur poached, dan microgreens", base_price: 45000, labels: ["new", "recommended"], sort_order: 2, is_featured: false, image_urls: ["https://placehold.co/400x300/16a34a/white?text=Avo+Toast"] },
        { id: pid(12), tenant_id: T, category_id: catMap["Snack & Dessert"], name: "Croissant Butter", description: "Croissant renyah dengan mentega premium Prancis", base_price: 22000, labels: [], sort_order: 1, is_featured: false, image_urls: ["https://placehold.co/400x300/d97706/white?text=Croissant"] },
        { id: pid(13), tenant_id: T, category_id: catMap["Snack & Dessert"], name: "Banana Cake", description: "Cake pisang lembut dengan cream cheese frosting", base_price: 28000, labels: ["best_seller"], sort_order: 2, is_featured: false, image_urls: ["https://placehold.co/400x300/f59e0b/white?text=Banana+Cake"] },
    ];

    const { error } = await supabase.from("products").insert(products);
    if (error) throw new Error(`Products error: ${error.message}`);
    console.log(`✅ Products: ${products.length}`);
    return { productIds: Object.fromEntries(products.map((p) => [p.name, p.id])) };
}

async function seedVariants(productIds: Record<string, string>) {
    const T = TENANT_ID;
    const g = (n: number) => `${T.slice(0, 8)}-grp0-0000-0000-${String(n).padStart(12, "0")}`;

    const groups = [
        { id: "aaaaaaaa-0003-0000-0000-000000000001", product_id: productIds["Es Kopi Susu"], tenant_id: T, name: "Ukuran", is_required: true, max_selections: 1, sort_order: 1 },
        { id: "aaaaaaaa-0003-0000-0000-000000000002", product_id: productIds["Es Kopi Susu"], tenant_id: T, name: "Tingkat Manis", is_required: true, max_selections: 1, sort_order: 2 },
        { id: "aaaaaaaa-0003-0000-0000-000000000003", product_id: productIds["Latte"], tenant_id: T, name: "Pilihan Susu", is_required: true, max_selections: 1, sort_order: 1 },
        { id: "aaaaaaaa-0003-0000-0000-000000000004", product_id: productIds["Matcha Latte"], tenant_id: T, name: "Ukuran", is_required: true, max_selections: 1, sort_order: 1 },
        { id: "aaaaaaaa-0003-0000-0000-000000000005", product_id: productIds["Matcha Latte"], tenant_id: T, name: "Tingkat Manis", is_required: false, max_selections: 1, sort_order: 2 },
    ];

    const { error: ge } = await supabase.from("product_variant_groups").insert(groups);
    if (ge) throw new Error(`Variant groups error: ${ge.message}`);

    const options = [
        { group_id: "aaaaaaaa-0003-0000-0000-000000000001", tenant_id: T, name: "Regular (16oz)", additional_price: 0, sort_order: 1 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000001", tenant_id: T, name: "Large (22oz)", additional_price: 5000, sort_order: 2 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000002", tenant_id: T, name: "Less Sweet (30%)", additional_price: 0, sort_order: 1 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000002", tenant_id: T, name: "Normal (70%)", additional_price: 0, sort_order: 2 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000002", tenant_id: T, name: "Extra Sweet (100%)", additional_price: 0, sort_order: 3 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000003", tenant_id: T, name: "Susu Segar", additional_price: 0, sort_order: 1 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000003", tenant_id: T, name: "Oat Milk", additional_price: 8000, sort_order: 2 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000003", tenant_id: T, name: "Almond Milk", additional_price: 10000, sort_order: 3 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000004", tenant_id: T, name: "Regular", additional_price: 0, sort_order: 1 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000004", tenant_id: T, name: "Large", additional_price: 6000, sort_order: 2 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000005", tenant_id: T, name: "Less Sweet", additional_price: 0, sort_order: 1 },
        { group_id: "aaaaaaaa-0003-0000-0000-000000000005", tenant_id: T, name: "Normal", additional_price: 0, sort_order: 2 },
    ];

    const { error: oe } = await supabase.from("product_variant_options").insert(options);
    if (oe) throw new Error(`Variant options error: ${oe.message}`);
    console.log(`✅ Variant groups: ${groups.length}, options: ${options.length}`);
}

async function seedTables() {
    const tables = Array.from({ length: 10 }, (_, i) => ({
        tenant_id: TENANT_ID,
        table_number: String(i + 1).padStart(2, "0"),
        display_name: `Meja ${String(i + 1).padStart(2, "0")}`,
    }));
    tables.push(
        { tenant_id: TENANT_ID, table_number: "VIP-1", display_name: "Meja VIP 1" },
        { tenant_id: TENANT_ID, table_number: "VIP-2", display_name: "Meja VIP 2" }
    );

    const { error } = await supabase.from("tables").insert(tables);
    if (error) throw new Error(`Tables error: ${error.message}`);
    console.log(`✅ Tables: ${tables.length}`);
}

async function seedOwnerAccount() {
    const email = "owner@kafe-asik.com";
    const password = "KafeAsik123!";

    const { data: user, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });

    if (authError && !authError.message.includes("already")) {
        console.warn(`⚠️  Auth user skip: ${authError.message}`);
        return;
    }

    const userId = user?.user?.id;
    if (!userId) { console.warn("⚠️  Could not get owner user ID, skipping profile insert"); return; }

    await supabase.from("profiles").delete().eq("user_id", userId);
    const { error: profileError } = await supabase.from("profiles").insert({
        user_id: userId,
        tenant_id: TENANT_ID,
        full_name: "Owner Kafe Asik",
        role: "OWNER",
        is_active: true,
    });
    if (profileError) console.warn(`⚠️  Profile insert: ${profileError.message}`);
    else console.log(`✅ Owner: ${email} / ${password}`);
}

async function seedCashierAccount() {
    const email = "kasir@kafe-asik.com";
    const password = "Kasir123!";

    const { data: user, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
    });
    if (error && !error.message.includes("already")) { console.warn(`⚠️  Cashier skip: ${error.message}`); return; }

    const userId = user?.user?.id;
    if (!userId) return;

    await supabase.from("profiles").delete().eq("user_id", userId);
    await supabase.from("profiles").insert({
        user_id: userId, tenant_id: TENANT_ID,
        full_name: "Kasir 1", role: "CASHIER", is_active: true,
    });
    console.log(`✅ Cashier: ${email} / ${password}`);
}

async function seedKitchenAccount() {
    const email = "dapur@kafe-asik.com";
    const password = "Dapur123!";

    const { data: user, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
    });
    if (error && !error.message.includes("already")) { console.warn(`⚠️  Kitchen skip: ${error.message}`); return; }

    const userId = user?.user?.id;
    if (!userId) return;

    await supabase.from("profiles").delete().eq("user_id", userId);
    await supabase.from("profiles").insert({
        user_id: userId, tenant_id: TENANT_ID,
        full_name: "Tim Dapur", role: "KITCHEN", is_active: true,
    });
    console.log(`✅ Kitchen: ${email} / ${password}`);
}

async function main() {
    console.log("\n🚀 Pesanin App — Seeder");
    console.log("========================");
    try {
        await clean();
        await seedTenant();
        const cats = await seedCategories();
        const { productIds } = await seedProducts(cats);
        await seedVariants(productIds);
        await seedTables();
        await seedOwnerAccount();
        await seedCashierAccount();
        await seedKitchenAccount();

        console.log("\n========================");
        console.log("✅ Seeder selesai!");
        console.log(`\n📌 URL Kiosk  : http://localhost:3000/${TENANT_SLUG}/kiosk`);
        console.log(`📌 URL Kasir  : http://localhost:3000/${TENANT_SLUG}/cashier`);
        console.log(`📌 URL Dapur  : http://localhost:3000/${TENANT_SLUG}/kitchen`);
        console.log("\n🔑 Akun Testing:");
        console.log("   Owner  : owner@kafe-asik.com  / KafeAsik123!");
        console.log("   Kasir  : kasir@kafe-asik.com  / Kasir123!");
        console.log("   Dapur  : dapur@kafe-asik.com  / Dapur123!");
    } catch (err) {
        console.error("\n❌ Seeder gagal:", err);
        process.exit(1);
    }
}

main();
