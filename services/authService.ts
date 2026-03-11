import { getSupabaseClient } from "@/lib/supabase";
import type { Profile } from "@/types";

function sb() { return getSupabaseClient(); }

export async function getCurrentProfile(): Promise<Profile | null> {
    const { data: { user } } = await sb().auth.getUser();
    if (!user) return null;
    const { data, error } = await sb()
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .single();
    if (error || !data) return null;
    return data as Profile;
}

export async function signIn(email: string, password: string) {
    return sb().auth.signInWithPassword({ email, password });
}

export async function signOut() {
    return sb().auth.signOut();
}

export async function getProfilesByTenant(tenantId: string): Promise<Profile[]> {
    const { data, error } = await sb()
        .from("profiles")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
    if (error || !data) return [];
    return data as Profile[];
}
