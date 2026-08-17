/**
 * staffService.ts — Client-side service untuk manajemen akun staf.
 *
 * Semua operasi diteruskan ke /api/admin/staff (server route)
 * agar SUPABASE_SERVICE_ROLE_KEY tidak pernah bocor ke browser.
 */

import type { Profile, UserRole } from "@/types";

export interface CreateStaffPayload {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  tenantId: string | null;
}

export interface StaffListItem extends Profile {
  // Profile sudah punya: id, user_id, tenant_id, full_name, role, is_active
  created_at?: string;
}

/** Buat akun staf baru (auth + profile) */
export async function createStaffAccount(payload: CreateStaffPayload): Promise<{ success: boolean; profileId?: string; error?: string }> {
  const res = await fetch("/api/admin/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? "Gagal membuat akun" };
  return { success: true, profileId: data.profileId };
}

/** Ambil daftar staf per tenant */
export async function getStaffByTenant(tenantId: string): Promise<StaffListItem[]> {
  const res = await fetch(`/api/admin/staff?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.staff ?? [];
}

/** Ambil semua staf semua tenant (hanya Super Admin) */
export async function getAllStaff(): Promise<StaffListItem[]> {
  const res = await fetch("/api/admin/staff");
  if (!res.ok) return [];
  const data = await res.json();
  return data.staff ?? [];
}

/** Toggle aktif/nonaktif akun staf */
export async function toggleStaffActive(profileId: string, isActive: boolean): Promise<boolean> {
  const res = await fetch("/api/admin/staff", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, isActive }),
  });
  return res.ok;
}

/** Label display per role */
export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER:       "Admin Outlet",
  CASHIER:     "Kasir",
  KITCHEN:     "Dapur",
  RUNNER:      "Runner",
};

/** Badge color per role */
export const ROLE_COLOR: Record<UserRole, { bg: string; text: string }> = {
  SUPER_ADMIN: { bg: "#ede9fe", text: "#6d28d9" },
  OWNER:       { bg: "#dbeafe", text: "#1e40af" },
  CASHIER:     { bg: "#d1fae5", text: "#065f46" },
  KITCHEN:     { bg: "#fef3c7", text: "#92400e" },
  RUNNER:      { bg: "#e0f2fe", text: "#0369a1" },
};
