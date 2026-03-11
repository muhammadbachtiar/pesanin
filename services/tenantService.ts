import { supabase } from "@/lib/supabase";
import type { Tenant } from "@/types";

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
    const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as Tenant;
}

export async function getAllTenants(): Promise<Tenant[]> {
    const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Tenant[];
}

export async function createTenant(payload: Partial<Tenant>): Promise<Tenant | null> {
    const { data, error } = await supabase.from("tenants").insert(payload).select().single();
    if (error || !data) return null;
    return data as Tenant;
}

export async function updateTenant(id: string, payload: Partial<Tenant>): Promise<boolean> {
    const { error } = await supabase.from("tenants").update(payload).eq("id", id);
    return !error;
}
