import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/env";
import type { Tenant } from "@/types";

function adminClient() {
    return createClient(
        getSupabaseUrl(),
        getSupabaseServiceRoleKey(),
        { auth: { autoRefreshToken: false, persistSession: false } }
    );
}

export async function getTenantBySlugServer(slug: string): Promise<Tenant | null> {
    const { data, error } = await adminClient()
        .from("tenants")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as Tenant;
}

export async function getAllTenantsServer(): Promise<Tenant[]> {
    const { data, error } = await adminClient()
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Tenant[];
}
