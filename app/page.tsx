"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRightOutlined,
  DashboardOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { getCurrentProfile, getTenantSlugById } from "@/services/authService";
import { getRoleHome } from "@/lib/rolePaths";
import { TenantFinder } from "@/components/auth/TenantFinder";

const FEATURES = [
  {
    icon: <MobileOutlined className="text-indigo-300 text-lg" />,
    title: "Kiosk Mandiri",
    text: "Pelanggan scan QR di meja dan pesan sendiri — tanpa akun, tanpa antre.",
  },
  {
    icon: <DashboardOutlined className="text-emerald-300 text-lg" />,
    title: "Kasir & Dapur Realtime",
    text: "Pesanan, stok, dan promo tersinkron instan di semua layar outlet.",
  },
  {
    icon: <ThunderboltOutlined className="text-amber-300 text-lg" />,
    title: "Ganti Shift dengan PIN",
    text: "Staf masuk cepat 4–6 digit PIN langsung dari tablet outlet.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // Sesi aktif → langsung ke halaman sesuai role (kasir ke kasir, owner ke admin, dst.)
  useEffect(() => {
    let alive = true;
    (async () => {
      const profile = await getCurrentProfile();
      if (!alive) return;
      if (profile?.role === "SUPER_ADMIN") {
        router.replace("/super-admin");
        return;
      }
      if (profile?.tenant_id) {
        const slug = await getTenantSlugById(profile.tenant_id);
        if (!alive) return;
        if (slug) {
          router.replace(getRoleHome(profile.role, slug));
          return;
        }
      }
      setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#09090b] text-white font-sans flex flex-col">
      <div className="pointer-events-none absolute top-[-25%] left-[-10%] w-[80%] h-[80%] rounded-full bg-indigo-600/20 blur-[130px]" />
      <div className="pointer-events-none absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/15 blur-[110px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-25" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-12 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/35">
            <ShopOutlined className="text-white text-lg" />
          </div>
          <span className="font-extrabold text-xl tracking-tight">Pesanin</span>
        </div>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            id="nav-admin-login"
            href="/admin-login"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white px-3 py-2 rounded-lg transition-colors"
          >
            <SafetyCertificateOutlined /> Admin Platform
          </Link>
          <Link
            id="nav-staff-login"
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-bold bg-white text-gray-950 hover:bg-gray-100 px-4 py-2.5 rounded-xl transition-colors"
          >
            Masuk Email <ArrowRightOutlined className="text-[10px]" />
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex-1 flex items-center px-6 sm:px-12 py-10">
        <div className="mx-auto w-full max-w-6xl grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="space-y-6">
            <span className="inline-flex text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full">
              Platform Kiosk &amp; POS F&amp;B
            </span>
            <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-[1.05] tracking-tight">
              Pemesanan mandiri &amp; kasir pintar untuk{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">restoran modern.</span>
            </h1>
            <p className="text-gray-400 text-base leading-relaxed max-w-xl">
              Kelola kiosk, kasir, dapur, dan stok dalam satu platform realtime. Tamu cukup scan QR di meja — staf cukup masukkan PIN.
            </p>

            <div className="grid sm:grid-cols-3 gap-3 pt-2">
              {FEATURES.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.1 }}
                  className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-sm space-y-2"
                >
                  <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">{f.icon}</div>
                  <div className="text-sm font-bold">{f.title}</div>
                  <p className="text-xs text-gray-400 leading-relaxed">{f.text}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Gerbang outlet */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 110, delay: 0.2 }}
            className="w-full max-w-md mx-auto lg:ml-auto rounded-3xl bg-white/[0.05] border border-white/10 backdrop-blur-xl shadow-2xl p-6 sm:p-8 space-y-5"
          >
            <div className="space-y-1.5">
              <h2 className="text-xl font-extrabold tracking-tight">Masuk ke Outlet Anda</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Cari nama restoran Anda untuk membuka halaman login staf (PIN cepat atau email).
              </p>
            </div>

            <TenantFinder theme="dark" />

            <div className="flex items-center gap-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              <span className="h-px flex-1 bg-white/10" />
              atau
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <Link
              id="cta-email-login"
              href="/login"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 hover:bg-white/5 text-sm font-bold transition-colors"
            >
              Masuk dengan Email &amp; Password
            </Link>

            <p className="text-[11px] text-gray-500 text-center leading-relaxed">
              Pelanggan? Cukup scan QR code di meja Anda — tidak perlu login.
            </p>
          </motion.div>
        </div>
      </section>

      <footer className="relative z-10 px-6 sm:px-12 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
        <span>Pesanin F&amp;B Platform © 2026. All rights reserved.</span>
        <Link href="/admin-login" className="sm:hidden font-semibold text-gray-400 hover:text-white">
          Admin Platform
        </Link>
      </footer>
    </main>
  );
}
