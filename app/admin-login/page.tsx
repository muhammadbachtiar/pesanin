"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { getCurrentProfile, signIn, signOut } from "@/services/authService";

export default function AdminLoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Sudah login sebagai Super Admin → langsung ke dashboard
  useEffect(() => {
    let alive = true;
    getCurrentProfile().then((p) => {
      if (!alive) return;
      if (p?.role === "SUPER_ADMIN") router.replace("/super-admin");
      else setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await signIn(email, password);
      if (authError) {
        setError("Email atau password yang Anda masukkan salah.");
        return;
      }
      const profile = await getCurrentProfile();
      if (!profile || profile.role !== "SUPER_ADMIN") {
        await signOut();
        setError("Akun ini tidak memiliki akses Super Admin.");
        return;
      }
      router.replace("/super-admin");
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan sistem. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#05050a]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05050a] flex items-center justify-center p-6 font-sans">
      <div className="pointer-events-none absolute top-[-25%] left-[-10%] w-[70%] h-[70%] rounded-full bg-violet-700/20 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-600/15 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,#000_60%,transparent_100%)] opacity-20" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="relative w-full max-w-md"
      >
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-2xl shadow-violet-500/30 ring-4 ring-white/5">
            <SafetyCertificateOutlined className="text-white text-3xl" />
          </div>
          <span className="mt-5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300 bg-violet-500/10 border border-violet-500/20 px-3 py-1 rounded-full">
            Platform Control
          </span>
          <h1 className="mt-3 text-3xl font-extrabold text-white tracking-tight">Admin Pesanin</h1>
          <p className="text-sm text-gray-400 mt-1.5 max-w-xs">
            Akses khusus pengelola platform: tenant, billing, dan konfigurasi sistem.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-xl shadow-2xl p-6 space-y-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="admin-login-email" className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
              Email Super Admin
            </label>
            <div className="relative">
              <MailOutlined className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
              <input
                id="admin-login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@pesanin.id"
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm font-medium outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/20 transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-login-password" className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
              Password
            </label>
            <div className="relative">
              <LockOutlined className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
              <input
                id="admin-login-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-11 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm font-medium outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl py-2.5 px-3"
              >
                ⚠️ {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button
            id="admin-login-submit"
            type="submit"
            disabled={loading}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-bold shadow-lg shadow-violet-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              "Memverifikasi..."
            ) : (
              <>
                Masuk ke Platform <ArrowRightOutlined className="text-xs" />
              </>
            )}
          </motion.button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <Link href="/login" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Staf atau pemilik outlet? Masuk di sini →
          </Link>
          <p className="text-[10px] text-gray-600">Pesanin F&amp;B Platform © 2026</p>
        </div>
      </motion.div>
    </main>
  );
}
