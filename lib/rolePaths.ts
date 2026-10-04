import type { UserRole } from "@/types";

/** Role staf operasional yang boleh memakai Quick PIN login. */
export const PIN_ELIGIBLE_ROLES: UserRole[] = ["CASHIER", "KITCHEN", "RUNNER"];

/** Mapping role → halaman utama. SUPER_ADMIN tidak terikat slug tenant. */
export function getRoleHome(role: UserRole, slug: string | null): string {
  if (role === "SUPER_ADMIN") return "/super-admin";
  if (!slug) return "/login";
  switch (role) {
    case "OWNER":   return `/${slug}/admin`;
    case "CASHIER": return `/${slug}/cashier`;
    case "KITCHEN": return `/${slug}/kitchen`;
    case "RUNNER":  return `/${slug}/runner`;
    default:        return `/${slug}/kiosk`;
  }
}

/** Hanya izinkan redirect `next` ke dalam area tenant yang sama (cegah open redirect). */
export function safeNextPath(next: string | null | undefined, slug: string): string | null {
  if (!next) return null;
  if (!next.startsWith(`/${slug}/`) || next.startsWith("//")) return null;
  if (next.startsWith(`/${slug}/login`)) return null;
  return next;
}
