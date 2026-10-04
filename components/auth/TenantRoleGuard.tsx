"use client";

/**
 * TenantRoleGuard — Komponen guard untuk halaman internal tenant.
 *
 * Fungsi:
 * 1. Cek apakah user sudah login. Jika belum → redirect ke /[slug]/login
 *    (portal login ber-branding outlet), membawa ?next= agar kembali ke halaman asal.
 * 2. Cek apakah role user diizinkan untuk halaman ini.
 *    Jika tidak → redirect ke halaman yang sesuai role-nya.
 * 3. Cek multi-tenant isolation: profile.tenant_id === currentTenantId.
 *    Jika staf Tenant A mencoba buka halaman Tenant B → ditolak
 *    (tanpa auto-redirect, karena slug outlet asal mereka tidak diketahui;
 *    tersedia tombol "Keluar & ganti akun").
 * 4. Mode POS-only guard:
 *    Jika tenant is pos_only dan role adalah KITCHEN/RUNNER
 *    → redirect ke /[slug]/cashier dengan pesan informatif.
 * 5. Staf operasional (CASHIER/KITCHEN/RUNNER) mendapat tombol melayang
 *    "Ganti Staf" untuk pergantian shift cepat via Quick PIN.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCurrentProfile, signOut } from "@/services/authService";
import { getRoleHome } from "@/lib/rolePaths";
import type { Profile, UserRole } from "@/types";

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

export function TenantRoleGuard({
  tenantSlug,
  tenantId,
  isPosOnly = false,
  allowedRoles,
  children,
}: TenantRoleGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"loading" | "allowed" | "denied">("loading");
  const [denyReason, setDenyReason] = useState<string>("");
  const [autoRedirect, setAutoRedirect] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loginPath = `/${tenantSlug}/login`;

  const switchStaff = async () => {
    await signOut();
    window.location.href = loginPath;
  };

  useEffect(() => {
    async function check() {
      const p = await getCurrentProfile();

      // 1. Belum login
      if (!p) {
        router.replace(`${loginPath}?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setProfile(p);

      // 2. Multi-tenant isolation (skip untuk SUPER_ADMIN karena akses platform-wide)
      if (p.role !== "SUPER_ADMIN" && tenantId && p.tenant_id !== tenantId) {
        setDenyReason(
          `Anda tidak memiliki akses ke outlet ini. Akun Anda terdaftar di outlet yang berbeda.`
        );
        setAutoRedirect(false);
        setStatus("denied");
        return;
      }

      // 3. Mode POS-only guard — KITCHEN/RUNNER tidak relevan, redirect ke kasir
      if (isPosOnly && (p.role === "KITCHEN" || p.role === "RUNNER")) {
        router.replace(`/${tenantSlug}/cashier`);
        return;
      }

      // 4. Cek role diizinkan — OWNER & SUPER_ADMIN bisa akses semua halaman tenant
      const isOwnerOrSuperAdmin = p.role === "OWNER" || p.role === "SUPER_ADMIN";
      if (!isOwnerOrSuperAdmin && !allowedRoles.includes(p.role)) {
        setDenyReason(
          `Role Anda (${p.role}) tidak memiliki akses ke halaman ini.`
        );
        setStatus("denied");
        setTimeout(() => {
          router.replace(getRoleHome(p.role, tenantSlug));
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
          {autoRedirect ? (
            <>
              <p className="text-gray-500 text-xs">Mengalihkan ke halaman Anda...</p>
              <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 animate-[shrink_3s_linear_forwards]" />
              </div>
            </>
          ) : (
            <button
              onClick={switchStaff}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors cursor-pointer"
            >
              Keluar &amp; masuk dengan akun outlet ini
            </button>
          )}
        </div>
      </div>
    );
  }

  const isOperationalStaff =
    profile && (profile.role === "CASHIER" || profile.role === "KITCHEN" || profile.role === "RUNNER");

  return (
    <>
      {children}
      {isOperationalStaff && (
        <button
          onClick={switchStaff}
          title="Ganti staf / keluar"
          aria-label="Ganti staf atau keluar"
          className="group fixed bottom-3 left-3 z-[60] flex items-center gap-2 h-9 pl-2.5 pr-2.5 hover:pr-3.5 rounded-full bg-gray-900/80 hover:bg-gray-900 text-white backdrop-blur-md shadow-lg border border-white/10 cursor-pointer transition-all"
        >
          <span className="text-sm leading-none">⏻</span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-bold group-hover:max-w-[160px] transition-all duration-300">
            Ganti Staf{profile?.full_name ? ` · ${profile.full_name}` : ""}
          </span>
        </button>
      )}
    </>
  );
}
