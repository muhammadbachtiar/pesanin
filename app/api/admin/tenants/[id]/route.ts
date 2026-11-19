import { NextResponse } from "next/server";
import { requireSuperAdmin, requireTenantAccess, createSupabaseAdminClient } from "@/lib/serverAuth";
import { removeTenantAssets } from "@/lib/storage";

/**
 * Field yang boleh diubah oleh OWNER outlet.
 * Slug, status aktif (suspend), dan alur bisnis (business_logic) hanya boleh diubah SUPER_ADMIN.
 */
const OWNER_EDITABLE_FIELDS = ["logo_url", "manual_payment_channels", "finance_config", "receipt_config"] as const;

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const { profile, error } = await requireTenantAccess(id);
    if (error) return error;

    if (profile.role !== "SUPER_ADMIN" && profile.role !== "OWNER") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBody = (await req.json()) as Record<string, unknown>;
    let body: Record<string, unknown> = rawBody;

    if (profile.role === "OWNER") {
        body = {};
        for (const key of OWNER_EDITABLE_FIELDS) {
            if (key in rawBody) body[key] = rawBody[key];
        }
        if (Object.keys(body).length === 0) {
            return NextResponse.json({ error: "Tidak ada field yang boleh diubah oleh Owner." }, { status: 403 });
        }
    }

    const sb = createSupabaseAdminClient();

    const { error: dbErr } = await sb.from("tenants").update(body).eq("id", id);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const sb = createSupabaseAdminClient();

    // Cascade delete — hapus semua relasi dulu
    const { data: groups } = await sb
        .from("product_variant_groups")
        .select("id")
        .eq("tenant_id", id);

    if (groups && groups.length > 0) {
        await sb
            .from("product_variant_options")
            .delete()
            .in("group_id", groups.map((g) => g.id));
    }

    await sb.from("product_variant_groups").delete().eq("tenant_id", id);
    await sb.from("order_items").delete().eq("tenant_id", id);
    await sb.from("orders").delete().eq("tenant_id", id);
    await sb.from("products").delete().eq("tenant_id", id);
    await sb.from("categories").delete().eq("tenant_id", id);
    await sb.from("tables").delete().eq("tenant_id", id);
    await sb.from("profiles").delete().eq("tenant_id", id);
    const { error: dbErr } = await sb.from("tenants").delete().eq("id", id);

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });

    // Bersihkan seluruh file gambar milik tenant dari Supabase Storage
    await removeTenantAssets(id);

    return NextResponse.json({ ok: true });
}
