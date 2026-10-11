"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { signIn, signOut, getCurrentProfile } from "@/services/authService";
import { getSupabaseClient } from "@/lib/supabase";
import { getRoleHome } from "@/lib/rolePaths";
import { TenantFinder } from "@/components/auth/TenantFinder";
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  ShopOutlined,
  CloseOutlined,
  MailOutlined,
  LockOutlined,
  ArrowRightOutlined
} from "@ant-design/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFinderModal, setShowFinderModal] = useState(false);

  /** Cari slug outlet dari tenant_id */
  const resolveSlug = async (tenantId: string) => {
    const { data: tenant } = await getSupabaseClient()
      .from("tenants")
      .select("slug")
      .eq("id", tenantId)
      .single();
    return (tenant?.slug as string | undefined) ?? null;
  };

  // Sudah punya sesi aktif → langsung ke halaman role-nya
  useEffect(() => {
    let alive = true;
    getCurrentProfile().then(async (p) => {
      if (!alive || !p) return;
      if (p.role === "SUPER_ADMIN") {
        router.replace("/super-admin");
        return;
      }
      if (p.tenant_id) {
        const slug = await resolveSlug(p.tenant_id);
        if (alive && slug) router.replace(getRoleHome(p.role, slug));
      }
    });
    return () => { alive = false; };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await signIn(email, password);
      if (authError) {
        setError("Email atau password yang Anda masukkan salah.");
        setLoading(false);
        return;
      }
      const profile = await getCurrentProfile();
      if (!profile) {
        await signOut();
        setError("Akun tidak ditemukan atau tidak aktif.");
        setLoading(false);
        return;
      }
      if (profile.role === "SUPER_ADMIN") {
        await signOut();
        setError("Akun Super Admin masuk melalui halaman khusus: /admin-login.");
        setLoading(false);
        return;
      }
      if (!profile.tenant_id) {
        await signOut();
        setError("Akun belum terhubung ke outlet mana pun. Hubungi administrator.");
        setLoading(false);
        return;
      }
      const slug = await resolveSlug(profile.tenant_id);
      if (!slug) {
        await signOut();
        setError("Konfigurasi outlet tidak ditemukan.");
        setLoading(false);
        return;
      }
      router.push(getRoleHome(profile.role, slug));
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan sistem. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden flex flex-col justify-between font-sans selection:bg-indigo-500 selection:text-white text-slate-900">

      {/* ── Soft Ambient Glow Orbs for Depth (Subtle & Elegant) ── */}
      <div className="absolute top-[-10%] left-[-10%] w-[520px] h-[520px] rounded-full bg-indigo-200/25 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[520px] h-[520px] rounded-full bg-violet-200/20 blur-[130px] pointer-events-none" />

      {/* ── Main Centered Container (Facebook UX Hierarchy) ── */}
      <div className="relative flex-1 flex items-center justify-center px-4 sm:px-6 py-12 lg:py-24">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">

          {/* ── Left Column: Brand & Single Clear Tagline ── */}
          <div className="lg:col-span-7 text-center lg:text-left space-y-4 lg:pr-8">
            <div className="inline-flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-600 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-500/25 ring-4 ring-indigo-50">
                <ShopOutlined className="text-white text-2xl font-bold" />
              </div>
              <span className="text-4xl sm:text-5xl font-black text-indigo-600 tracking-tight">
                pesanin
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
              Sistem Kiosk &amp; POS Pintar untuk <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">Outlet Modern.</span>
            </h1>

            <p className="text-base sm:text-lg text-slate-600 font-normal leading-relaxed max-w-lg mx-auto lg:mx-0">
              Kelola transaksi kasir, monitor pesanan dapur, dan kiosk mandiri dalam satu ekosistem realtime yang terintegrasi.
            </p>
          </div>

          {/* ── Right Column: Aesthetic White Card ── */}
          <div className="lg:col-span-5 w-full max-w-[430px] mx-auto">
            <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-[0_20px_50px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.05)] border border-slate-200/60 p-7 sm:p-9 space-y-6">

              <div>
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Selamat Datang
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Masuk menggunakan email outlet atau akun manajemen Anda.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">

                {/* Email Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Alamat Email
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors pointer-events-none">
                      <MailOutlined className="text-base" />
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="kasir@restoran.com"
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-medium text-sm"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                    Kata Sandi
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors pointer-events-none">
                      <LockOutlined className="text-base" />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="w-full pl-10 pr-11 py-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-medium text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 cursor-pointer"
                      aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                    >
                      {showPassword ? (
                        <EyeInvisibleOutlined className="text-base" />
                      ) : (
                        <EyeOutlined className="text-base" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      className="p-3 rounded-xl border border-rose-200 bg-rose-50/80 text-rose-800 text-xs font-semibold flex items-center gap-2"
                    >
                      <span>⚠️</span>
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:from-indigo-700 active:to-indigo-800 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/35 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Memverifikasi Akun...</span>
                    </>
                  ) : (
                    <>
                      <span>Masuk ke Dashboard</span>
                      <ArrowRightOutlined className="text-xs" />
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200/80" />
                </div>
                <div className="relative flex justify-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span className="bg-white px-3">atau</span>
                </div>
              </div>

              {/* Secondary Button: Modal Cari Outlet (FB style "Create new account") */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowFinderModal(true)}
                  className="w-full py-3 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 active:bg-emerald-100 text-emerald-800 font-bold text-sm border border-emerald-200/70 shadow-sm hover:border-emerald-300 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>🔍 Cari Outlet Saya (PIN Cepat)</span>
                </button>
              </div>

            </div>

            {/* Platform Admin Note below card */}
            <div className="text-center text-xs text-slate-500 mt-6">
              Pengelola platform?{" "}
              <Link href="/admin-login" className="font-bold text-slate-700 hover:text-indigo-600 hover:underline transition-colors">
                Masuk Admin Platform &rarr;
              </Link>
            </div>

          </div>

        </div>
      </div>

      {/* ── Modal Cari Outlet (Popup Dialog seperti Facebook Dialog) ── */}
      <AnimatePresence>
        {showFinderModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFinderModal(false)}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="relative bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full p-6 sm:p-7 z-10 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Cari Outlet Restoran</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Pilih outlet Anda untuk login via PIN Cepat atau Kiosk</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFinderModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer text-xs font-bold"
                  aria-label="Tutup dialog"
                >
                  <CloseOutlined />
                </button>
              </div>

              <TenantFinder theme="light" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Simple Minimal Footer ── */}
      <footer className="py-6 px-4 text-center text-xs text-slate-400 border-t border-slate-200/50 bg-white/40">
        Pesanin F&amp;B Platform &copy; 2026. All rights reserved.
      </footer>

    </div>
  );
}
