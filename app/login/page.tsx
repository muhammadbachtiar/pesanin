"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { signIn, getCurrentProfile } from "@/services/authService";
import { getSupabaseClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { 
  MailOutlined, 
  LockOutlined, 
  EyeOutlined, 
  EyeInvisibleOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  ShopOutlined,
  DashboardOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        setError("Akun tidak ditemukan atau tidak aktif.");
        setLoading(false);
        return;
      }
      if (profile.role === "SUPER_ADMIN") {
        router.push("/super-admin");
      } else if (profile.tenant_id) {
        const { data: tenant } = await getSupabaseClient()
          .from("tenants")
          .select("slug")
          .eq("id", profile.tenant_id)
          .single();
        const slug = tenant?.slug;
        if (!slug) { 
          setError("Konfigurasi outlet tidak ditemukan."); 
          setLoading(false); 
          return; 
        }
        if (profile.role === "CASHIER") router.push(`/${slug}/cashier`);
        else if (profile.role === "KITCHEN") router.push(`/${slug}/kitchen`);
        else if (profile.role === "OWNER") router.push(`/${slug}/admin`);
        else router.push(`/${slug}/kiosk`);
      }
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan sistem. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50/50 font-sans">
      
      {/* ── LEFT PANEL: Startup Branding & Value Prop (Desktop only) ── */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#09090b] overflow-hidden flex-col justify-between p-12">
        {/* Glow Effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[100px] pointer-events-none" />
        
        {/* Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-25 pointer-events-none" />

        {/* Top Header */}
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/35">
            <ShopOutlined className="text-white text-lg font-bold" />
          </div>
          <span className="text-white font-extrabold text-xl tracking-tight">Pesanin</span>
          <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-500/20">v2.4</span>
        </div>

        {/* Hero Section */}
        <div className="relative my-auto max-w-lg space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-[1.1] tracking-tight">
              Sistem Kiosk & POS Pintar untuk <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Restoran Modern.</span>
            </h1>
            <p className="text-gray-400 text-base leading-relaxed">
              Kelola pemesanan mandiri, verifikasi kasir, dan koordinasi dapur secara realtime dalam satu platform F&B yang andal dan terintegrasi.
            </p>
          </div>

          {/* Feature List */}
          <div className="space-y-4">
            {[
              { icon: <ThunderboltOutlined className="text-amber-400 text-base" />, text: "Kiosk Mandiri responsif & minim antrean" },
              { icon: <DashboardOutlined className="text-indigo-400 text-base" />, text: "Layar Kasir & Dapur tersinkronisasi instan" },
              { icon: <CheckCircleOutlined className="text-emerald-400 text-base" />, text: "Konfigurasi tenant & menu dinamis dalam 1 klik" }
            ].map((feat, i) => (
              <motion.div 
                key={i} 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className="flex items-center gap-3 text-gray-300 text-sm font-medium"
              >
                <div className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-800 flex items-center justify-center shrink-0">
                  {feat.icon}
                </div>
                <span>{feat.text}</span>
              </motion.div>
            ))}
          </div>

          {/* Decorative Mockup Widget */}
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 100, delay: 0.5 }}
            className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl flex items-center gap-4 max-w-sm"
          >
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xl shrink-0">
              ⚡
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between items-center">
                <span className="text-white text-xs font-bold truncate">Restoran Anda Saat Ini</span>
                <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">Online</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">Terhubung ke 5 Kiosk & 3 monitor Dapur</p>
            </div>
          </motion.div>
        </div>

        {/* Footer */}
        <div className="relative text-gray-500 text-xs font-medium">
          Pesanin F&B Platform &copy; 2026. All rights reserved.
        </div>
      </div>

      {/* ── RIGHT PANEL: Clean Startup Login Form (Mobile/Desktop) ── */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-6 sm:p-12 md:p-20 bg-white">
        
        {/* Top Header Mobile only */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center">
            <ShopOutlined className="text-white text-sm" />
          </div>
          <span className="text-gray-950 font-bold text-lg tracking-tight">Pesanin</span>
        </div>

        <div className="my-auto max-w-md w-full mx-auto space-y-8">
          
          {/* Headline */}
          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
              Selamat Datang Kembali
            </h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              Silakan masuk untuk mulai mengelola transaksi, memonitor menu dapur, dan memproses pesanan outlet Anda.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            
            {/* Input Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                Alamat Email
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <MailOutlined className="text-sm" />
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 outline-none text-gray-950 placeholder-gray-400 focus:border-indigo-600 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all text-sm font-medium"
                  placeholder="name@restaurant.com"
                />
              </div>
            </div>

            {/* Input Password */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
                  Password Akun
                </label>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <LockOutlined className="text-sm" />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-gray-200 bg-gray-50/50 outline-none text-gray-950 placeholder-gray-400 focus:border-indigo-600 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all text-sm font-medium"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <EyeInvisibleOutlined className="text-base" />
                  ) : (
                    <EyeOutlined className="text-base" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Alert with Animation */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold flex items-start gap-2.5"
                >
                  <span className="text-base leading-none">⚠️</span>
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit Button */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#09090b] hover:bg-gray-900 active:bg-black text-white text-sm font-bold shadow-lg shadow-gray-900/10 hover:shadow-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Mengecek Akun...</span>
                </>
              ) : (
                <>
                  <span>Masuk ke Dashboard</span>
                  <ArrowRightOutlined className="text-xs" />
                </>
              )}
            </motion.button>

          </form>

        </div>

        {/* Footer for Mobile view */}
        <div className="lg:hidden text-center text-gray-400 text-[11px] font-medium pt-8 mt-auto">
          Pesanin F&B Platform &copy; 2026.
        </div>

      </div>

    </div>
  );
}
