import { supabase } from "@/lib/supabase";
import type { TableRecord } from "@/types";

export async function getTablesByTenant(tenantId: string): Promise<TableRecord[]> {
    const { data, error } = await supabase
        .from("tables")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("table_number");
    if (error || !data) return [];
    return data as TableRecord[];
}

export async function validateTableToken(
    tenantId: string,
    tableNumber: string,
    token: string
): Promise<TableRecord | null> {
    const { data, error } = await supabase
        .from("tables")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("table_number", tableNumber)
        .eq("current_token", token)
        .single();
    if (error || !data) return null;
    return data as TableRecord;
}

export async function rotateTableToken(tableId: string): Promise<string | null> {
    const { data, error } = await supabase.rpc("rotate_table_token", {
        p_table_id: tableId,
    });
    if (error || !data) return null;
    return data as string;
}

export async function setTableStatus(
    tableId: string,
    status: "available" | "occupied" | "broken"
): Promise<boolean> {
    const { error } = await supabase
        .from("tables")
        .update({ status })
        .eq("id", tableId);
    return !error;
}
