import { NextResponse } from "next/server";
import { requireSuperAdmin, createSupabaseAdminClient } from "@/lib/serverAuth";
import { relocateUnassignedAsset } from "@/lib/storage";

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

    // Relokasi aset yang diupload ke _unassigned/ saat Wizard tenant baru dibuat
    if (tenant) {
        const updates: Record<string, unknown> = {};
        if (tenant.logo_url) {
            const relocatedLogo = await relocateUnassignedAsset(tenant.logo_url, tenant.id);
            if (relocatedLogo !== tenant.logo_url) {
                updates.logo_url = relocatedLogo;
                tenant.logo_url = relocatedLogo;
            }
        }
        if (Array.isArray(tenant.manual_payment_channels)) {
            let channelsChanged = false;
            const relocatedChannels = await Promise.all(
                tenant.manual_payment_channels.map(async (ch: Record<string, unknown>) => {
                    if (typeof ch.image_url === "string" && ch.image_url) {
                        const nextUrl = await relocateUnassignedAsset(ch.image_url, tenant.id);
                        if (nextUrl !== ch.image_url) {
                            channelsChanged = true;
                            return { ...ch, image_url: nextUrl };
                        }
                    }
                    return ch;
                })
            );
            if (channelsChanged) {
                updates.manual_payment_channels = relocatedChannels;
                tenant.manual_payment_channels = relocatedChannels;
            }
        }
        if (Object.keys(updates).length > 0) {
            await sb.from("tenants").update(updates).eq("id", tenant.id);
        }
    }

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
