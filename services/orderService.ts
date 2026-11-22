import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { dedupeInFlight } from "@/lib/idempotency";
import type { Order, OrderItem, OrderStatus, PaymentMethodType, VerificationStatus } from "@/types";

let _serverAdminClient: SupabaseClient | null = null;

/**
 * Gunakan Service Role Client saat berada di lingkungan Server / Node Script
 * agar operasi pemotongan/pengembalian stok & mutasi pesanan tidak terblokir RLS anon.
 * Di browser, fungsi mutasi publik (Kiosk checkout & auto-cancel) diteruskan ke /api/orders.
 */
function getDb(): SupabaseClient {
    if (typeof window === "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        if (!_serverAdminClient) {
            _serverAdminClient = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY,
                { auth: { autoRefreshToken: false, persistSession: false } }
            );
        }
        return _serverAdminClient;
    }
    return supabase as unknown as SupabaseClient;
}

export interface CreateOrderPayload {
    tenant_id: string;
    queue_number: string;
    table_number?: string;
    table_id?: string;
    order_type: "dine_in" | "takeaway";
    subtotal: number;
    tax_amount: number;
    service_charge_amount: number;
    takeaway_fee_amount: number;
    total_amount: number;
    payment_method?: PaymentMethodType;
    selected_manual_channel_id?: string;
    customer_name?: string;
    customer_notes?: string;
    created_by_cashier?: boolean;
    cashier_profile_id?: string;
    finance_snapshot: Record<string, number>;
}

export interface CreateOrderItemPayload {
    order_id: string;
    tenant_id: string;
    product_id?: string;
    product_name_snapshot: string;
    base_price_snapshot: number;
    selected_variants: { group: string; option: string; additional_price: number }[];
    quantity: number;
    unit_price: number;
    subtotal: number;
    notes?: string;
}

export async function createOrder(
    order: CreateOrderPayload,
    items: Omit<CreateOrderItemPayload, "order_id" | "tenant_id">[],
    idempotencyKey?: string
): Promise<Order | null> {
    const itemFingerprint = items
        .map((i) => `${i.product_id ?? i.product_name_snapshot}:${i.quantity}:${i.unit_price}:${i.notes ?? ""}`)
        .join("|");
    const dedupeKey = idempotencyKey
        ? `createOrder:idem:${idempotencyKey}`
        : `createOrder:fp:${order.tenant_id}:${order.order_type}:${order.table_number ?? ""}:${order.customer_name ?? ""}:${order.total_amount}:${itemFingerprint}`;

    return dedupeInFlight(
        dedupeKey,
        async () => {
            // Jika dipanggil dari Browser (Kiosk/Kasir), teruskan ke /api/orders agar pemotongan stok
            // dieksekusi secara atomik di server menggunakan Service Role (tidak terblokir RLS anon di Kiosk).
            if (typeof window !== "undefined") {
                const res = await fetch("/api/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "createOrder", order, items }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || "Gagal membuat pesanan di sistem");
                }
                return data.order as Order;
            }

            const db = getDb();

            // ── 1. PRE-CHECK STOCK VALIDATION (Mencegah Race Condition / Overselling) ──
            const productIds = Array.from(
                new Set(items.map((i) => i.product_id).filter((id): id is string => Boolean(id)))
            );

            if (productIds.length > 0) {
                const { data: currentProducts, error: prodErr } = await db
                    .from("products")
                    .select("id, name, stock_count, is_available")
                    .in("id", productIds);

                if (!prodErr && currentProducts) {
                    const prodMap = new Map(
                        (currentProducts as { id: string; name: string; stock_count: number | null; is_available: boolean }[]).map((p) => [p.id, p])
                    );

                    for (const pid of productIds) {
                        const prod = prodMap.get(pid);
                        const sampleItem = items.find((i) => i.product_id === pid);
                        const menuName = prod?.name ?? sampleItem?.product_name_snapshot ?? "Menu";
                        const requestedQty = items
                            .filter((i) => i.product_id === pid)
                            .reduce((sum, i) => sum + i.quantity, 0);

                        if (!prod || !prod.is_available) {
                            throw new Error(`Menu "${menuName}" saat ini sedang habis.`);
                        }

                        if (prod.stock_count !== null && prod.stock_count < requestedQty) {
                            if (prod.stock_count <= 0) {
                                throw new Error(`Menu "${menuName}" baru saja habis dipesan pelanggan lain.`);
                            } else {
                                throw new Error(
                                    `Menu "${menuName}" hanya tersisa ${prod.stock_count} porsi (Anda meminta ${requestedQty}).`
                                );
                            }
                        }
                    }
                }
            }

            let finalNotes = order.customer_notes || "";
            if (order.customer_name?.trim() && !finalNotes.includes("[NAME:")) {
                const { cleanNotes, isServed, cookedItemIds } = parseCustomerNotes(finalNotes);
                finalNotes = buildCustomerNotes(cleanNotes, isServed, cookedItemIds, order.customer_name);
            }

            const payloadWithNotes = {
                ...order,
                customer_notes: finalNotes || undefined,
            };

            let { data: orderData, error: orderError } = await db
                .from("orders")
                .insert(payloadWithNotes)
                .select()
                .single();

            // Fallback: If 'customer_name' column is not in Supabase schema yet, retry without 'customer_name' key
            if (orderError && (orderError.message?.includes("customer_name") || orderError.code === "PGRST204")) {
                const { customer_name, ...payloadWithoutNameCol } = payloadWithNotes;
                const retryResult = await db
                    .from("orders")
                    .insert(payloadWithoutNameCol)
                    .select()
                    .single();
                orderData = retryResult.data;
                orderError = retryResult.error;
            }

            if (orderError || !orderData) {
                console.error("Error creating order:", orderError);
                throw new Error(orderError?.message || "Gagal membuat pesanan di sistem");
            }

            const itemRows = items.map((i) => ({
                ...i,
                order_id: orderData.id,
                tenant_id: order.tenant_id,
            }));
            await db.from("order_items").insert(itemRows);

            // ── 2. AUTO-DEDUCT STOCK ──────────────────────────────────────────────
            // Kurangi stock_count per produk yang memiliki kuota stok terbatas.
            // Jika stok mencapai 0, otomatis set is_available = false.
            if (productIds.length > 0) {
                const { data: stockRows } = await db
                    .from("products")
                    .select("id, stock_count, is_available")
                    .in("id", productIds);

                if (stockRows) {
                    for (const row of stockRows as { id: string; stock_count: number | null; is_available: boolean }[]) {
                        if (row.stock_count === null) continue; // unlimited — skip
                        const ordered = items
                            .filter((i) => i.product_id === row.id)
                            .reduce((sum, i) => sum + i.quantity, 0);
                        const newStock = Math.max(0, Number(row.stock_count) - ordered);
                        const shouldDeactivate = newStock <= 0;
                        await db.from("products").update({
                            stock_count: newStock,
                            ...(shouldDeactivate ? { is_available: false } : {}),
                        }).eq("id", row.id);
                    }
                }
            }
            // ── END AUTO-DEDUCT ───────────────────────────────────────────────────

            return orderData as Order;
        },
        idempotencyKey ? 30_000 : 8_000
    );
}

export async function getOrdersByTenant(
    tenantId: string,
    statuses?: OrderStatus[],
    dateFrom?: string,
    dateTo?: string
): Promise<Order[]> {
    const db = getDb();
    let query = db
        .from("orders")
        .select("*, items:order_items(*)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

    if (statuses?.length) query = query.in("order_status", statuses);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as Order[];
}

/** Lightweight query for analytics — no items join, just order rows. */
export async function getOrdersForAnalytics(
    tenantId: string,
    dateFrom: string,
    dateTo: string
): Promise<Order[]> {
    const db = getDb();
    const { data, error } = await db
        .from("orders")
        .select("id, created_at, order_status, payment_status, order_type, total_amount, subtotal, tax_amount, service_charge_amount, takeaway_fee_amount, created_by_cashier, queue_number, table_number")
        .eq("tenant_id", tenantId)
        .gte("created_at", dateFrom)
        .lte("created_at", dateTo)
        .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Order[];
}

export async function getOrderById(orderId: string): Promise<Order | null> {
    const db = getDb();
    const { data, error } = await db
        .from("orders")
        .select("*, items:order_items(*)")
        .eq("id", orderId)
        .single();
    if (error || !data) return null;
    return data as Order;
}

export async function updateOrderStatus(
    orderId: string,
    status: OrderStatus
): Promise<boolean> {
    return dedupeInFlight(`updateStatus:${orderId}:${status}`, async () => {
        const db = getDb();
        const { error } = await db
            .from("orders")
            .update({ order_status: status })
            .eq("id", orderId);
        return !error;
    });
}

export async function markOrderPaid(
    orderId: string,
    method: PaymentMethodType,
    verifiedByProfileId?: string | null,
    targetOrderStatus?: OrderStatus
): Promise<boolean> {
    return dedupeInFlight(
        `markPaid:${orderId}`,
        async () => {
            const db = getDb();
            const { data: existing } = await db
                .from("orders")
                .select("order_status, payment_status")
                .eq("id", orderId)
                .single();

            if (existing?.payment_status === "paid" && (!targetOrderStatus || existing?.order_status === targetOrderStatus)) {
                return true;
            }

            const newStatus = targetOrderStatus
                ? targetOrderStatus
                : existing?.order_status === "pending"
                ? "cooking"
                : (existing?.order_status as OrderStatus) ?? "cooking";

            const isValidUuid =
                verifiedByProfileId &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verifiedByProfileId);

            const normalizedMethod: PaymentMethodType =
                (method as string) === "qris" ? "qris_static" : method;

            const updatePayload = {
                payment_status: "paid",
                payment_method: normalizedMethod,
                verification_status: "verified" as VerificationStatus,
                verified_by: isValidUuid ? verifiedByProfileId : null,
                verified_at: new Date().toISOString(),
                order_status: newStatus,
            };

            let { error } = await db.from("orders").update(updatePayload).eq("id", orderId);
            // Fallback jika verified_by tidak ditemukan di tabel profiles (FK constraint)
            if (error && updatePayload.verified_by) {
                const retry = await db
                    .from("orders")
                    .update({ ...updatePayload, verified_by: null })
                    .eq("id", orderId);
                error = retry.error;
            }
            return !error;
        },
        5_000
    );
}

export async function markOrderServed(
    orderId: string,
    currentNotes?: string | null
): Promise<boolean> {
    return dedupeInFlight(`markServed:${orderId}`, async () => {
        const db = getDb();
        let baseNotes = currentNotes;
        if (baseNotes === undefined) {
            const { data } = await db.from("orders").select("customer_notes").eq("id", orderId).single();
            baseNotes = data?.customer_notes ?? "";
        }
        const newNotes = baseNotes
            ? baseNotes.includes("[SERVED]")
                ? baseNotes
                : `${baseNotes} [SERVED]`
            : "[SERVED]";
        const { error } = await db
            .from("orders")
            .update({ customer_notes: newNotes })
            .eq("id", orderId);
        return !error;
    });
}

export async function approveOrder(
    orderId: string,
    cashierProfileId: string
): Promise<boolean> {
    return dedupeInFlight(`approve:${orderId}`, async () => {
        const db = getDb();
        const { error } = await db.from("orders").update({
            verification_status: "verified",
            verified_by: cashierProfileId,
            verified_at: new Date().toISOString(),
            order_status: "cooking",
        }).eq("id", orderId);
        return !error;
    });
}

export async function voidOrder(
    orderId: string,
    reason: string,
    cashierProfileId?: string | null
): Promise<boolean> {
    return dedupeInFlight(
        `void:${orderId}`,
        async () => {
            if (typeof window !== "undefined") {
                const res = await fetch("/api/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "voidOrder", orderId, reason, cashierProfileId }),
                });
                return res.ok;
            }

            const db = getDb();
            const isValidUuid =
                cashierProfileId &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cashierProfileId);

            const { data: claimedRows, error: claimError } = await db
                .from("orders")
                .update({
                    order_status: "cancelled",
                    verification_status: "rejected",
                    void_reason: reason,
                    voided_by: isValidUuid ? cashierProfileId : null,
                    voided_at: new Date().toISOString(),
                })
                .eq("id", orderId)
                .neq("order_status", "cancelled")
                .select("id");

            if (claimError) {
                console.error("voidOrder claim error:", claimError);
                return false;
            }

            if (!claimedRows || claimedRows.length === 0) {
                return true;
            }

            // ── 1. AUTO-RESTORE STOCK (Hanya dieksekusi tepat 1x saat klaim berhasil) ─
            const { data: orderItems } = await db
                .from("order_items")
                .select("product_id, quantity")
                .eq("order_id", orderId);

            if (orderItems && orderItems.length > 0) {
                const productIds = (orderItems as { product_id: string | null; quantity: number }[])
                    .map((i) => i.product_id)
                    .filter((id): id is string => Boolean(id));

                if (productIds.length > 0) {
                    const { data: stockRows } = await db
                        .from("products")
                        .select("id, stock_count, is_available")
                        .in("id", productIds);

                    if (stockRows) {
                        for (const row of stockRows as { id: string; stock_count: number | null; is_available: boolean }[]) {
                            if (row.stock_count === null) continue; // unlimited — skip
                            const returned = (orderItems as { product_id: string | null; quantity: number }[])
                                .filter((i) => i.product_id === row.id)
                                .reduce((sum: number, i: { product_id: string | null; quantity: number }) => sum + i.quantity, 0);
                            const newStock = Number(row.stock_count) + returned;
                            const shouldReactivate = !row.is_available && newStock > 0;
                            await db.from("products").update({
                                stock_count: newStock,
                                ...(shouldReactivate ? { is_available: true } : {}),
                            }).eq("id", row.id);
                        }
                    }
                }
            }
            // ── END AUTO-RESTORE ─────────────────────────────────────────────────

            return true;
        },
        10_000
    );
}

export async function generateQueueNumber(tenantId: string): Promise<string> {
    const db = getDb();
    const { data, error } = await db.rpc("generate_queue_number", {
        p_tenant_id: tenantId,
    });
    if (error || !data) return "001";
    return data as string;
}

export function parseCustomerNotes(notes: string | null, rawCustomerName?: string | null) {
    const rawNotes = notes || "";
    const cleanNotes = rawNotes
        .replace(/\[SERVED\]/g, "")
        .replace(/\[COOKED:[^\]]*\]/g, "")
        .replace(/\[NAME:[^\]]*\]/g, "")
        .trim();

    const isServed = rawNotes.includes("[SERVED]");

    const nameMatch = rawNotes.match(/\[NAME:([^\]]*)\]/);
    const customerName = rawCustomerName?.trim() || (nameMatch && nameMatch[1] ? nameMatch[1].trim() : null);

    const cookedMatch = rawNotes.match(/\[COOKED:([^\]]*)\]/);
    const cookedItemIds = cookedMatch && cookedMatch[1]
        ? cookedMatch[1].split(",")
        : [];

    return { cleanNotes, isServed, cookedItemIds, customerName };
}

export function buildCustomerNotes(cleanNotes: string, isServed: boolean, cookedItemIds: string[], customerName?: string | null) {
    const parts: string[] = [];
    if (cleanNotes) parts.push(cleanNotes);
    if (customerName) parts.push(`[NAME:${customerName.trim()}]`);
    if (isServed) parts.push("[SERVED]");
    if (cookedItemIds.length > 0) parts.push(`[COOKED:${cookedItemIds.join(",")}]`);
    return parts.join(" ").trim();
}

// Antrian serial per orderId agar tap cepat pada checklist dapur tidak saling menimpa (out-of-order)
const cookedItemsChain = new Map<string, Promise<boolean>>();

export async function updateOrderCookedItems(
    orderId: string,
    notesSnapshot: string | null,
    cookedItemIds: string[]
): Promise<boolean> {
    const { cleanNotes, isServed, customerName } = parseCustomerNotes(notesSnapshot);
    const newNotes = buildCustomerNotes(cleanNotes, isServed, cookedItemIds, customerName);

    const prev = cookedItemsChain.get(orderId) ?? Promise.resolve(true);
    const next = prev
        .catch(() => true)
        .then(async () => {
            const db = getDb();
            const { error } = await db
                .from("orders")
                .update({ customer_notes: newNotes || null })
                .eq("id", orderId);
            return !error;
        });

    cookedItemsChain.set(orderId, next);
    return next;
}

export async function getActiveOrderByTable(
    tenantId: string,
    tableNumber: string
): Promise<Order | null> {
    const trimmedTable = tableNumber.trim();
    if (!trimmedTable) return null;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const db = getDb();
    const { data, error } = await db
        .from("orders")
        .select("id, queue_number, table_number, order_status, created_at")
        .eq("tenant_id", tenantId)
        .ilike("table_number", trimmedTable)
        .in("order_status", ["pending", "cooking", "ready"])
        .gte("created_at", startOfToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) return null;
    return data[0] as Order;
}

/**
 * Membersihkan pesanan pending (belum lunas) yang tidak kunjung dikonfirmasi
 * setelah melewati batas waktu 30 menit secara otomatis.
 * Mengubah status menjadi 'cancelled' (void) dan mengembalikan stok produk ke semula.
 */
export async function autoCancelStalePendingOrders(tenantId: string, maxAgeMinutes = 30): Promise<number> {
    if (typeof window !== "undefined") {
        try {
            const res = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "autoCancelStalePendingOrders", tenantId, maxAgeMinutes }),
            });
            if (!res.ok) return 0;
            const data = await res.json();
            return data.cancelledCount ?? 0;
        } catch {
            return 0;
        }
    }

    const db = getDb();
    const cutoffIso = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const { data: staleOrders, error } = await db
        .from("orders")
        .select("id, queue_number")
        .eq("tenant_id", tenantId)
        .eq("order_status", "pending")
        .eq("payment_status", "unpaid")
        .lt("created_at", cutoffIso);

    if (error || !staleOrders || staleOrders.length === 0) return 0;

    let count = 0;
    for (const ord of staleOrders) {
        const ok = await voidOrder(
            ord.id,
            `Dibatalkan otomatis: Tidak dikonfirmasi/dilunasi dalam ${maxAgeMinutes} menit`,
            null
        );
        if (ok) count++;
    }
    return count;
}
