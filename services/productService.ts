import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { dedupeInFlight } from "@/lib/idempotency";
import type { Category, Product, ProductVariantGroup } from "@/types";

let _serverAdminClient: SupabaseClient | null = null;
function getWriteDb(): SupabaseClient {
    if (typeof window === "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        if (!_serverAdminClient) {
            _serverAdminClient = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY,
                { auth: { autoRefreshToken: false, persistSession: false } }
            );
        }
        return _serverAdminClient;
    }
    return supabase as unknown as SupabaseClient;
}

export async function getCategoriesWithProducts(tenantId: string): Promise<Category[]> {
    const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("sort_order");
    if (error || !data) return [];
    return data as Category[];
}

export async function getProductsByTenant(tenantId: string): Promise<Product[]> {
    const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_available", true)
        .order("is_featured", { ascending: false })
        .order("sort_order");
    if (error || !data) return [];
    return data as Product[];
}

export async function getProductVariants(productId: string): Promise<ProductVariantGroup[]> {
    const { data: groups, error } = await supabase
        .from("product_variant_groups")
        .select("*, options:product_variant_options(*)")
        .eq("product_id", productId)
        .order("sort_order");
    if (error || !groups) return [];
    return groups as ProductVariantGroup[];
}

export async function toggleProductAvailability(
    productId: string,
    isAvailable: boolean,
    stockCount?: number | null
): Promise<boolean> {
    const key = `toggleProduct:${productId}:${isAvailable}:${stockCount ?? ""}`;
    return dedupeInFlight(key, async () => {
        const payload: Record<string, unknown> = { is_available: isAvailable };
        if (stockCount !== undefined) payload.stock_count = stockCount;
        const { error } = await getWriteDb().from("products").update(payload).eq("id", productId);
        return !error;
    });
}

export async function updateProduct(
    productId: string,
    updates: Partial<Omit<Product, "id" | "tenant_id">>
): Promise<{ success: boolean; error?: string }> {
    const key = `updateProduct:${productId}:${JSON.stringify(updates)}`;
    return dedupeInFlight(key, async () => {
        const { error } = await getWriteDb().from("products").update(updates).eq("id", productId);
        if (error) {
            console.error("updateProduct error:", error);
            return { success: false, error: error.message };
        }
        return { success: true };
    });
}

export async function getAllProductsByTenant(tenantId: string): Promise<Product[]> {
    const { data, error } = await supabase
        .from("products")
        .select("*, category:categories(name)")
        .eq("tenant_id", tenantId)
        .order("is_featured", { ascending: false })
        .order("sort_order");
    if (error || !data) return [];
    return data as Product[];
}
