import { supabase } from "@/lib/supabase";
import { dedupeInFlight } from "@/lib/idempotency";
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
    const key = `createTenant:${payload.slug ?? payload.name ?? ""}`;
    return dedupeInFlight(
        key,
        async () => {
            const { data, error } = await supabase.from("tenants").insert(payload).select().single();
            if (error || !data) return null;
            return data as Tenant;
        },
        5_000
    );
}

export async function updateTenant(id: string, payload: Partial<Tenant>): Promise<boolean> {
    const key = `updateTenant:${id}:${JSON.stringify(payload)}`;
    return dedupeInFlight(key, async () => {
        try {
            const res = await fetch(`/api/admin/tenants/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            // Jangan fallback ke direct client bila server menolak (403/400),
            // agar whitelist field Owner di server tidak bisa dilewati.
            return res.ok;
        } catch {
            // Fallback ke direct client hanya bila fetch tidak tersedia (mis. dipanggil di luar browser)
        }
        const { error } = await supabase.from("tenants").update(payload).eq("id", id);
        return !error;
    });
}
