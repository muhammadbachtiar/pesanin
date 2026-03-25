import { supabase } from "@/lib/supabase";
import type { Order, OrderItem, OrderStatus, PaymentMethodType, VerificationStatus } from "@/types";

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
    items: Omit<CreateOrderItemPayload, "order_id" | "tenant_id">[]
): Promise<Order | null> {
    const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .insert(order)
        .select()
        .single();
    if (orderError || !orderData) return null;

    const itemRows = items.map((i) => ({
        ...i,
        order_id: orderData.id,
        tenant_id: order.tenant_id,
    }));
    await supabase.from("order_items").insert(itemRows);

    return orderData as Order;
}

export async function getOrdersByTenant(
    tenantId: string,
    statuses?: OrderStatus[],
    dateFrom?: string,
    dateTo?: string
): Promise<Order[]> {
    let query = supabase
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
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { error } = await supabase
        .from("orders")
        .update({ order_status: status })
        .eq("id", orderId);
    return !error;
}

export async function markOrderPaid(
    orderId: string,
    method: PaymentMethodType,
    verifiedByProfileId: string
): Promise<boolean> {
    const { error } = await supabase.from("orders").update({
        payment_status: "paid",
        payment_method: method,
        verification_status: "verified",
        verified_by: verifiedByProfileId,
        verified_at: new Date().toISOString(),
        order_status: "cooking",
    }).eq("id", orderId);
    return !error;
}

export async function approveOrder(
    orderId: string,
    cashierProfileId: string
): Promise<boolean> {
    const { error } = await supabase.from("orders").update({
        verification_status: "verified",
        verified_by: cashierProfileId,
        verified_at: new Date().toISOString(),
        order_status: "cooking",
    }).eq("id", orderId);
    return !error;
}

export async function voidOrder(
    orderId: string,
    reason: string,
    cashierProfileId: string
): Promise<boolean> {
    const { error } = await supabase.from("orders").update({
        order_status: "cancelled",
        verification_status: "rejected",
        void_reason: reason,
        voided_by: cashierProfileId,
        voided_at: new Date().toISOString(),
    }).eq("id", orderId);
    return !error;
}

export async function generateQueueNumber(tenantId: string): Promise<string> {
    const { data, error } = await supabase.rpc("generate_queue_number", {
        p_tenant_id: tenantId,
    });
    if (error || !data) return "001";
    return data as string;
}
