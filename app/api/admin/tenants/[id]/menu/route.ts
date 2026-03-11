import { NextResponse } from "next/server";
import { requireSuperAdmin, createSupabaseAdminClient } from "@/lib/serverAuth";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const sb = createSupabaseAdminClient();

    const [{ data: categories, error: catErr }, { data: products, error: prodErr }] =
        await Promise.all([
            sb.from("categories").select("*").eq("tenant_id", id).order("sort_order"),
            sb.from("products").select("*").eq("tenant_id", id).order("sort_order"),
        ]);

    if (catErr) console.error("[menu GET] categories error:", catErr.message);
    if (prodErr) console.error("[menu GET] products error:", prodErr.message);

    return NextResponse.json({
        categories: categories ?? [],
        products: products ?? [],
    });
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await req.json();
    const sb = createSupabaseAdminClient();
    const { _type, ...payload } = body;

    if (_type === "category") {
        const { data, error: dbErr } = await sb
            .from("categories")
            .insert({ ...payload, tenant_id: id })
            .select()
            .single();
        if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
        return NextResponse.json(data);
    }

    if (_type === "product") {
        const { data, error: dbErr } = await sb
            .from("products")
            .insert({ ...payload, tenant_id: id, image_urls: payload.image_urls ?? [] })
            .select()
            .single();
        if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
        return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Unknown _type" }, { status: 400 });
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await req.json();
    const { _type, _itemId, ...payload } = body;
    const sb = createSupabaseAdminClient();

    const table = _type === "category" ? "categories" : "products";
    const { error: dbErr } = await sb.from(table).update(payload).eq("id", _itemId).eq("tenant_id", id);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await req.json();
    const { _type, _itemId } = body;
    const sb = createSupabaseAdminClient();

    if (_type === "product") {
        const { data: groups } = await sb
            .from("product_variant_groups")
            .select("id")
            .eq("product_id", _itemId);

        if (groups && groups.length > 0) {
            await sb
                .from("product_variant_options")
                .delete()
                .in("group_id", groups.map((g) => g.id));
        }
        await sb.from("product_variant_groups").delete().eq("product_id", _itemId);
    }

    const table = _type === "category" ? "categories" : "products";
    await sb.from(table).delete().eq("id", _itemId).eq("tenant_id", id);
    return NextResponse.json({ ok: true });
}
