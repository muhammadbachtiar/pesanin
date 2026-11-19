import { NextResponse } from "next/server";
import { requireTenantManager, createSupabaseAdminClient } from "@/lib/serverAuth";
import { removeAssetsByUrl } from "@/lib/storage";

/**
 * CRUD Kategori & Menu per tenant.
 * Akses: SUPER_ADMIN (semua tenant) atau OWNER (hanya tenant miliknya sendiri).
 */

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/** Buang field yang tidak boleh dikirim dari client (mencegah pindah tenant / timpa id). */
function sanitizePayload(payload: Record<string, unknown>) {
    const clean = { ...payload };
    delete clean.id;
    delete clean.tenant_id;
    delete clean.created_at;
    delete clean.category; // hasil join dari GET, bukan kolom
    return clean;
}

/** Pastikan category_id (jika ada) memang milik tenant ini. */
async function assertCategoryBelongsToTenant(sb: SupabaseAdmin, tenantId: string, categoryId: unknown) {
    if (!categoryId) return true;
    const { data } = await sb
        .from("categories")
        .select("id")
        .eq("id", categoryId as string)
        .eq("tenant_id", tenantId)
        .maybeSingle();
    return Boolean(data);
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const { error } = await requireTenantManager(id);
    if (error) return error;

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
    const { id } = await params;
    const { error } = await requireTenantManager(id);
    if (error) return error;

    const body = await req.json();
    const sb = createSupabaseAdminClient();
    const { _type, ...rawPayload } = body;
    const payload = sanitizePayload(rawPayload);

    if (_type === "category") {
        const cleanName = typeof payload.name === "string" ? payload.name.trim() : "";
        if (!cleanName) return NextResponse.json({ error: "Nama kategori wajib diisi" }, { status: 400 });

        // Idempotensi: kategori dengan nama sama di tenant yang sama tidak dibuat ulang
        const { data: existingCat } = await sb
            .from("categories")
            .select("*")
            .eq("tenant_id", id)
            .ilike("name", cleanName)
            .maybeSingle();
        if (existingCat) {
            return NextResponse.json(existingCat);
        }
        const { data, error: dbErr } = await sb
            .from("categories")
            .insert({ ...payload, name: cleanName, tenant_id: id })
            .select()
            .single();
        if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
        return NextResponse.json(data);
    }

    if (_type === "product") {
        const cleanName = typeof payload.name === "string" ? payload.name.trim() : "";
        if (!cleanName) return NextResponse.json({ error: "Nama menu wajib diisi" }, { status: 400 });

        if (!(await assertCategoryBelongsToTenant(sb, id, payload.category_id))) {
            return NextResponse.json({ error: "Kategori tidak valid untuk outlet ini" }, { status: 400 });
        }

        // Idempotensi: cegah duplikasi akibat retry jaringan / double submit dalam 10 detik
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const { data: recentDup } = await sb
            .from("products")
            .select("*")
            .eq("tenant_id", id)
            .ilike("name", cleanName)
            .gte("created_at", tenSecondsAgo)
            .maybeSingle();
        if (recentDup) {
            return NextResponse.json(recentDup);
        }
        const { data, error: dbErr } = await sb
            .from("products")
            .insert({ ...payload, name: cleanName, tenant_id: id, image_urls: payload.image_urls ?? [] })
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
    const { id } = await params;
    const { error } = await requireTenantManager(id);
    if (error) return error;

    const body = await req.json();
    const { _type, _itemId, ...rawPayload } = body;
    const payload = sanitizePayload(rawPayload);
    const sb = createSupabaseAdminClient();

    if (!_itemId) return NextResponse.json({ error: "_itemId wajib diisi" }, { status: 400 });

    if (_type === "product" && !(await assertCategoryBelongsToTenant(sb, id, payload.category_id))) {
        return NextResponse.json({ error: "Kategori tidak valid untuk outlet ini" }, { status: 400 });
    }

    const table = _type === "category" ? "categories" : "products";
    const { error: dbErr } = await sb.from(table).update(payload).eq("id", _itemId).eq("tenant_id", id);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const { error } = await requireTenantManager(id);
    if (error) return error;

    const body = await req.json();
    const { _type, _itemId } = body;
    const sb = createSupabaseAdminClient();

    if (_type === "product") {
        const { data: prodRow } = await sb
            .from("products")
            .select("id, image_urls")
            .eq("id", _itemId)
            .eq("tenant_id", id)
            .maybeSingle();

        // Produk tidak ditemukan di tenant ini → anggap sudah terhapus (idempoten)
        if (!prodRow) return NextResponse.json({ ok: true });

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

        const { error: delErr } = await sb.from("products").delete().eq("id", _itemId).eq("tenant_id", id);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

        if (Array.isArray(prodRow.image_urls)) {
            await removeAssetsByUrl(prodRow.image_urls);
        }
        return NextResponse.json({ ok: true });
    }

    if (_type === "category") {
        const { data: catRow } = await sb
            .from("categories")
            .select("id, image_url")
            .eq("id", _itemId)
            .eq("tenant_id", id)
            .maybeSingle();

        if (!catRow) return NextResponse.json({ ok: true });

        // Lepas relasi menu dari kategori ini agar menu tidak ikut hilang
        await sb.from("products").update({ category_id: null }).eq("category_id", _itemId).eq("tenant_id", id);

        const { error: delErr } = await sb.from("categories").delete().eq("id", _itemId).eq("tenant_id", id);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

        if (catRow.image_url) {
            await removeAssetsByUrl([catRow.image_url]);
        }
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown _type" }, { status: 400 });
}
