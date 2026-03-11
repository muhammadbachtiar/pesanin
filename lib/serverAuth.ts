import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Profile } from "@/types";

/** Server client yang membaca cookies dari request — respects RLS */
export async function createSupabaseServerClient() {
    const cookieStore = await cookies();
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll(toSet) {
                    try {
                        toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                    } catch { }
                },
            },
        }
    );
}

/** Admin client — bypass RLS sepenuhnya */
export function createSupabaseAdminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );
}

/** Ambil profile dari session cookie. Return null jika belum login. */
export async function getServerProfile(): Promise<Profile | null> {
    try {
        const sb = await createSupabaseServerClient();
        const { data: { user }, error } = await sb.auth.getUser();
        if (error || !user) return null;

        const admin = createSupabaseAdminClient();
        const { data } = await admin
            .from("profiles")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .single();

        return (data as Profile) ?? null;
    } catch {
        return null;
    }
}

type AuthGuardResult =
    | { profile: Profile; error: null }
    | { profile: null; error: Response };

/** Wajib login sebagai SUPER_ADMIN. Kembalikan error Response jika tidak. */
export async function requireSuperAdmin(): Promise<AuthGuardResult> {
    const profile = await getServerProfile();
    if (!profile) {
        return { profile: null, error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) };
    }
    if (profile.role !== "SUPER_ADMIN") {
        return { profile: null, error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) };
    }
    return { profile, error: null };
}

/** Wajib login. Staff hanya bisa akses tenant mereka sendiri. Super admin boleh semua. */
export async function requireTenantAccess(tenantId: string): Promise<AuthGuardResult> {
    const profile = await getServerProfile();
    if (!profile) {
        return { profile: null, error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) };
    }
    if (profile.role === "SUPER_ADMIN") {
        return { profile, error: null };
    }
    if (profile.tenant_id !== tenantId) {
        return { profile: null, error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) };
    }
    return { profile, error: null };
}
