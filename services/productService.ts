import { supabase } from "@/lib/supabase";
import type { Category, Product, ProductVariantGroup } from "@/types";

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
    const payload: Record<string, unknown> = { is_available: isAvailable };
    if (stockCount !== undefined) payload.stock_count = stockCount;
    const { error } = await supabase.from("products").update(payload).eq("id", productId);
    return !error;
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
