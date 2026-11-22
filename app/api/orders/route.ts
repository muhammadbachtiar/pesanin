import { NextResponse } from "next/server";
import { getServerProfile } from "@/lib/serverAuth";
import {
    createOrder,
    voidOrder,
    autoCancelStalePendingOrders,
    getOrderById,
    type CreateOrderPayload,
    type CreateOrderItemPayload,
} from "@/services/orderService";

/**
 * /api/orders — Server endpoint untuk operasi pesanan & stok atomik.
 *
 * Mengapa diperlukan:
 * 1. Di layar Kiosk (/kiosk), pelanggan tidak login (role Supabase = `anon`).
 *    RLS `anon` hanya mengizinkan SELECT pada `products` dan INSERT pada `orders`,
 *    tetapi tidak mengizinkan `anon` meng-UPDATE `products.stock_count` atau `orders.order_status`.
 * 2. Dengan mengeksekusi `createOrder` dan `autoCancelStalePendingOrders` di server route ini,
 *    validasi stok, pemotongan `stock_count`, penonaktifan `is_available = false` saat stok = 0,
 *    serta pengembalian stok saat pesanan > 30 menit kadaluarsa berjalan 100% atomik & aman.
 * 3. Untuk `voidOrder`, server memverifikasi sesi login staf:
 *    - `CASHIER` hanya diizinkan membatalkan pesanan yang berstatus `unpaid`.
 *    - Pesanan yang sudah `paid` hanya dapat di-Void oleh `OWNER` atau `SUPER_ADMIN`.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { action } = body;

        if (action === "createOrder") {
            const order = body.order as CreateOrderPayload;
            const items = body.items as Omit<CreateOrderItemPayload, "order_id" | "tenant_id">[];
            if (!order?.tenant_id || !Array.isArray(items) || items.length === 0) {
                return NextResponse.json({ error: "Payload pesanan tidak lengkap" }, { status: 400 });
            }
            const created = await createOrder(order, items);
            return NextResponse.json({ order: created });
        }

        if (action === "autoCancelStalePendingOrders") {
            const { tenantId, maxAgeMinutes } = body;
            if (!tenantId) {
                return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
            }
            const cancelledCount = await autoCancelStalePendingOrders(tenantId, maxAgeMinutes ?? 30);
            return NextResponse.json({ cancelledCount });
        }

        if (action === "voidOrder") {
            const { orderId, reason, cashierProfileId } = body;
            if (!orderId || !reason) {
                return NextResponse.json({ error: "orderId dan reason wajib diisi" }, { status: 400 });
            }

            const profile = await getServerProfile();
            if (!profile) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }

            const existingOrder = await getOrderById(orderId);
            if (!existingOrder) {
                return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
            }

            // Isolasi Multi-Tenant
            if (profile.role !== "SUPER_ADMIN" && profile.tenant_id !== existingOrder.tenant_id) {
                return NextResponse.json({ error: "Forbidden: Pesanan milik outlet lain" }, { status: 403 });
            }

            // Aturan Bisnis Poin #7: Kasir hanya boleh void pesanan belum lunas (unpaid).
            // Jika sudah lunas (paid), hanya OWNER atau SUPER_ADMIN yang boleh melakukan Void.
            if (existingOrder.payment_status === "paid" && profile.role !== "OWNER" && profile.role !== "SUPER_ADMIN") {
                return NextResponse.json(
                    { error: "Pesanan yang sudah LUNAS hanya dapat dibatalkan (Void) oleh Owner." },
                    { status: 403 }
                );
            }

            const ok = await voidOrder(orderId, reason, cashierProfileId ?? profile.id);
            if (!ok) {
                return NextResponse.json({ error: "Gagal membatalkan pesanan" }, { status: 500 });
            }
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ error: "Action tidak dikenali" }, { status: 400 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Terjadi kesalahan pada server";
        return NextResponse.json({ error: msg }, { status: 400 });
    }
}
