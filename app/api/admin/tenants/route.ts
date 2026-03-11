import { NextResponse } from "next/server";
import { requireSuperAdmin, createSupabaseAdminClient } from "@/lib/serverAuth";

export async function GET() {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const sb = createSupabaseAdminClient();
    const { data, error: dbErr } = await sb
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
    return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
    const { error } = await requireSuperAdmin();
    if (error) return error;

    const body = await req.json();
    const { ownerEmail, ownerPassword, ownerName, ...tenantPayload } = body;

    const sb = createSupabaseAdminClient();
    const { data: tenant, error: tErr } = await sb
        .from("tenants")
        .insert(tenantPayload)
        .select()
        .single();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });

    if (ownerEmail && ownerPassword) {
        const { data: user, error: uErr } = await sb.auth.admin.createUser({
            email: ownerEmail,
            password: ownerPassword,
            email_confirm: true,
        });

        if (uErr && !uErr.message.toLowerCase().includes("already")) {
            return NextResponse.json({ error: uErr.message, tenant }, { status: 207 });
        }

        const userId = user?.user?.id;
        if (userId) {
            await sb.from("profiles").upsert({
                user_id: userId,
                tenant_id: tenant.id,
                full_name: ownerName || "Owner",
                role: "OWNER",
                is_active: true,
            }, { onConflict: "user_id,tenant_id" });
        }
    }

    return NextResponse.json(tenant);
}
