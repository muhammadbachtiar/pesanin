"use client";

/**
 * TenantRoleGuard — Komponen guard untuk halaman internal tenant.
 *
 * Fungsi:
 * 1. Cek apakah user sudah login. Jika belum → redirect ke /login.
 * 2. Cek apakah role user diizinkan untuk halaman ini.
 *    Jika tidak → redirect ke halaman yang sesuai role-nya.
 * 3. Cek multi-tenant isolation: profile.tenant_id === currentTenantId.
 *    Jika staf Tenant A mencoba buka halaman Tenant B → ditolak.
 * 4. Mode POS-only guard:
 *    Jika tenant is pos_only dan role adalah KITCHEN/RUNNER
 *    → redirect ke /[slug]/cashier dengan pesan informatif.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentProfile } from "@/services/authService";
import type { UserRole } from "@/types";

interface TenantRoleGuardProps {
  /** Slug tenant dari URL param */
  tenantSlug: string;
  /** ID tenant yang di-load (untuk isolasi multi-tenant) */
  tenantId: string | null;
  /** Apakah tenant ini berstatus pos_only */
  isPosOnly?: boolean;
  /** Role yang diizinkan mengakses halaman ini */
  allowedRoles: UserRole[];
  /** Konten halaman yang diproteksi */
  children: React.ReactNode;
}

/** Mapping role → halaman defaultnya */
const ROLE_DEFAULT_PATH: Record<UserRole, (slug: string) => string> = {
  SUPER_ADMIN: () => "/super-admin",
  OWNER:       (slug) => `/${slug}/admin`,
  CASHIER:     (slug) => `/${slug}/cashier`,
  KITCHEN:     (slug) => `/${slug}/kitchen`,
  RUNNER:      (slug) => `/${slug}/runner`,
};

export function TenantRoleGuard({
  tenantSlug,
  tenantId,
  isPosOnly = false,
  allowedRoles,
  children,
}: TenantRoleGuardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "allowed" | "denied">("loading");
  const [denyReason, setDenyReason] = useState<string>("");

  useEffect(() => {
    async function check() {
      const profile = await getCurrentProfile();

      // 1. Belum login
      if (!profile) {
        router.replace("/login");
        return;
      }

      // 2. Multi-tenant isolation (skip untuk SUPER_ADMIN karena akses platform-wide)
      if (profile.role !== "SUPER_ADMIN" && tenantId && profile.tenant_id !== tenantId) {
        setDenyReason(
          `Anda tidak memiliki akses ke outlet ini. Akun Anda terdaftar di outlet yang berbeda.`
        );
        setStatus("denied");
        // Redirect ke halaman default role mereka setelah 3 detik
        setTimeout(() => {
          const path = ROLE_DEFAULT_PATH[profile.role]?.(tenantSlug) ?? "/login";
          router.replace(path);
        }, 3000);
        return;
      }

      // 3. Mode POS-only guard — KITCHEN/RUNNER tidak relevan, redirect ke kasir
      if (isPosOnly && (profile.role === "KITCHEN" || profile.role === "RUNNER")) {
        router.replace(`/${tenantSlug}/cashier`);
        return;
      }

      // 4. Cek role diizinkan — OWNER & SUPER_ADMIN bisa akses semua halaman tenant
      const isOwnerOrSuperAdmin = profile.role === "OWNER" || profile.role === "SUPER_ADMIN";
      if (!isOwnerOrSuperAdmin && !allowedRoles.includes(profile.role)) {
        setDenyReason(
          `Role Anda (${profile.role}) tidak memiliki akses ke halaman ini.`
        );
        setStatus("denied");
        setTimeout(() => {
          const path = ROLE_DEFAULT_PATH[profile.role]?.(tenantSlug) ?? "/login";
          router.replace(path);
        }, 3000);
        return;
      }

      setStatus("allowed");
    }

    check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-4 text-gray-400">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Memverifikasi akses...</span>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-6">
        <div className="max-w-sm w-full bg-gray-900 border border-red-500/30 rounded-2xl p-8 text-center space-y-4">
          <div className="text-5xl">🚫</div>
          <h2 className="text-white font-bold text-xl">Akses Ditolak</h2>
          <p className="text-gray-400 text-sm leading-relaxed">{denyReason}</p>
          <p className="text-gray-500 text-xs">Mengalihkan ke halaman Anda...</p>
          <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 animate-[shrink_3s_linear_forwards]" />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
