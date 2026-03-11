import { NextResponse } from "next/server";
import { requireSuperAdmin, createSupabaseAdminClient } from "@/lib/serverAuth";

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await req.json();
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
    return NextResponse.json({ ok: true });
}
