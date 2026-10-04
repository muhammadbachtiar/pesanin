"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  MailOutlined,
  ShopOutlined,
} from "@ant-design/icons";
import { getCurrentProfile, signIn, signOut } from "@/services/authService";
import { getRoleHome, safeNextPath } from "@/lib/rolePaths";
import { ROLE_COLOR, ROLE_LABEL } from "@/services/staffService";
import type { UserRole } from "@/types";

export interface LoginTenant {
  id: string;
  name: string;
  slug: string;
  subtitle: string | null;
  logo_url: string | null;
}

export interface LoginStaff {
  id: string;
  full_name: string | null;
  role: UserRole;
}

type Mode = "pin" | "email";

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function TenantLoginClient({ tenant, staff }: { tenant: LoginTenant; staff: LoginStaff[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"), tenant.slug);

  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>(staff.length > 0 ? "pin" : "email");
  const [selected, setSelected] = useState<LoginStaff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  // Email form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sudah login di outlet ini? langsung masuk.
  useEffect(() => {
    let alive = true;
    getCurrentProfile().then((p) => {
      if (!alive) return;
      if (p && p.role !== "SUPER_ADMIN" && p.tenant_id === tenant.id) {
        router.replace(next ?? getRoleHome(p.role, tenant.slug));
      } else {
        setChecking(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [router, tenant.id, tenant.slug, next]);

  const submitPin = useCallback(
    async (value: string) => {
      if (!selected || loading || value.length < 4) return;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/auth/pin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: tenant.slug, profileId: selected.id, pin: value }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "PIN salah.");
          setPin("");
          setShakeKey((k) => k + 1);
          setLoading(false);
          return;
        }
        router.replace(next ?? data.redirect);
      } catch {
        setError("Tidak dapat terhubung ke server. Coba lagi.");
        setLoading(false);
      }
    },
    [selected, loading, tenant.slug, next, router]
  );

  const pinRef = useRef(pin);
  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);

  const pressDigit = useCallback(
    (d: string) => {
      if (loading) return;
      const cur = pinRef.current;
      if (cur.length >= 6) return;
      const nextPin = cur + d;
      pinRef.current = nextPin;
      setError("");
      setPin(nextPin);
      if (nextPin.length === 6) setTimeout(() => submitPin(nextPin), 120);
    },
    [loading, submitPin]
  );

  const backspace = useCallback(() => {
    setError("");
    const nextPin = pinRef.current.slice(0, -1);
    pinRef.current = nextPin;
    setPin(nextPin);
  }, []);

  // Dukungan keyboard fisik saat PIN pad aktif
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressDigit(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Enter") submitPin(pinRef.current);
      else if (e.key === "Escape") {
        setSelected(null);
        setPin("");
        setError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, pressDigit, backspace, submitPin]);

  const handleEmailLogin = async (e: React.FormEvent) => {
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
      if (!profile) {
        await signOut();
        setError("Akun tidak ditemukan atau tidak aktif.");
        return;
      }
      if (profile.role === "SUPER_ADMIN") {
        await signOut();
        setError("Akun Super Admin tidak masuk lewat halaman outlet. Gunakan /admin-login.");
        return;
      }
      if (profile.tenant_id !== tenant.id) {
        await signOut();
        setError(`Akun ini tidak terdaftar di ${tenant.name}. Pastikan Anda memilih outlet yang benar.`);
        return;
      }
      router.replace(next ?? getRoleHome(profile.role, tenant.slug));
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan sistem. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--tenant-primary)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#09090b] flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
      {/* Glow berwarna tenant */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[70rem] h-[40rem] rounded-full opacity-25 blur-[140px]"
        style={{ background: "var(--tenant-primary)" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="relative w-full max-w-md"
      >
        {/* Brand outlet */}
        <div className="flex flex-col items-center text-center mb-6">
          {tenant.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url}
              alt={tenant.name}
              className="w-20 h-20 rounded-2xl bg-white object-contain p-2 shadow-2xl ring-4 ring-white/10"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl shadow-2xl ring-4 ring-white/10"
              style={{ background: "var(--tenant-primary)" }}
            >
              <ShopOutlined />
            </div>
          )}
          <h1 className="mt-4 text-2xl font-extrabold text-white tracking-tight">{tenant.name}</h1>
          <p className="text-sm text-gray-400 mt-1">{tenant.subtitle || "Portal Staf Outlet"}</p>
        </div>

        {/* Kartu login */}
        <div className="rounded-3xl bg-white/[0.04] border border-white/10 backdrop-blur-xl shadow-2xl p-5 sm:p-6">
          {/* Segmented control */}
          {!selected && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-white/5 mb-5">
              {([
                { key: "pin", label: "🔑 Staf (PIN)" },
                { key: "email", label: "✉️ Email & Password" },
              ] as { key: Mode; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  id={`login-tab-${t.key}`}
                  type="button"
                  onClick={() => {
                    setMode(t.key);
                    setError("");
                  }}
                  className={`py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    mode === t.key ? "text-white shadow-lg" : "text-gray-400 hover:text-gray-200"
                  }`}
                  style={mode === t.key ? { background: "var(--tenant-primary)" } : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {/* ── MODE PIN: pilih staf ── */}
            {mode === "pin" && !selected && (
              <motion.div key="pick" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} className="space-y-3">
                {staff.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <div className="text-4xl">🔑</div>
                    <p className="text-sm text-gray-300 font-semibold">Belum ada staf dengan PIN</p>
                    <p className="text-xs text-gray-500">Minta Admin Outlet mengatur PIN Anda, atau masuk dengan email.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 font-medium">Siapa yang bertugas? Pilih nama Anda:</p>
                    <div className="grid grid-cols-2 gap-3 max-h-[22rem] overflow-y-auto pr-1">
                      {staff.map((s) => {
                        const color = ROLE_COLOR[s.role];
                        return (
                          <motion.button
                            key={s.id}
                            type="button"
                            whileTap={{ scale: 0.96 }}
                            whileHover={{ y: -2 }}
                            onClick={() => {
                              setSelected(s);
                              setPin("");
                              setError("");
                            }}
                            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/25 transition-colors cursor-pointer"
                          >
                            <div
                              className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-extrabold text-white shadow-lg"
                              style={{ background: "var(--tenant-primary)" }}
                            >
                              {initials(s.full_name)}
                            </div>
                            <span className="text-sm font-bold text-white text-center leading-tight line-clamp-2">
                              {s.full_name || "Tanpa Nama"}
                            </span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: color.bg, color: color.text }}
                            >
                              {ROLE_LABEL[s.role]}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ── MODE PIN: keypad ── */}
            {mode === "pin" && selected && (
              <motion.div key="pad" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="space-y-5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setPin("");
                      setError("");
                    }}
                    className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-gray-300 flex items-center justify-center cursor-pointer transition-colors"
                    aria-label="Kembali pilih staf"
                  >
                    <ArrowLeftOutlined />
                  </button>
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold text-white shrink-0"
                      style={{ background: "var(--tenant-primary)" }}
                    >
                      {initials(selected.full_name)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{selected.full_name || "Tanpa Nama"}</div>
                      <div className="text-[11px] text-gray-400">{ROLE_LABEL[selected.role]}</div>
                    </div>
                  </div>
                </div>

                {/* Indikator PIN */}
                <motion.div
                  key={shakeKey}
                  animate={shakeKey ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : undefined}
                  transition={{ duration: 0.4 }}
                  className="flex justify-center gap-3 py-2"
                  aria-label="Indikator PIN"
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-3.5 h-3.5 rounded-full border transition-all duration-150 ${
                        i < pin.length ? "scale-110 border-transparent" : "border-white/25 bg-transparent"
                      }`}
                      style={i < pin.length ? { background: "var(--tenant-primary)" } : undefined}
                    />
                  ))}
                </motion.div>

                {error && (
                  <p role="alert" className="text-center text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl py-2.5 px-3">
                    {error}
                  </p>
                )}

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-3">
                  {KEYPAD.map((d) => (
                    <PadKey key={d} onClick={() => pressDigit(d)} disabled={loading}>
                      {d}
                    </PadKey>
                  ))}
                  <PadKey onClick={backspace} disabled={loading || pin.length === 0} subtle ariaLabel="Hapus digit">
                    <DeleteOutlined />
                  </PadKey>
                  <PadKey onClick={() => pressDigit("0")} disabled={loading}>
                    0
                  </PadKey>
                  <button
                    id="pin-submit"
                    type="button"
                    onClick={() => submitPin(pin)}
                    disabled={loading || pin.length < 4}
                    className="h-16 rounded-2xl text-white text-sm font-extrabold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 shadow-lg"
                    style={{ background: "var(--tenant-primary)" }}
                  >
                    {loading ? (
                      <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      "Masuk"
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── MODE EMAIL ── */}
            {mode === "email" && (
              <motion.form
                key="email"
                onSubmit={handleEmailLogin}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="tenant-login-email" className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Alamat Email
                  </label>
                  <div className="relative">
                    <MailOutlined className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                    <input
                      id="tenant-login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@restaurant.com"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm font-medium outline-none focus:border-white/40 focus:ring-4 focus:ring-white/10 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="tenant-login-password" className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Password
                  </label>
                  <div className="relative">
                    <LockOutlined className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                    <input
                      id="tenant-login-password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-11 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 text-sm font-medium outline-none focus:border-white/40 focus:ring-4 focus:ring-white/10 transition-all"
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

                {error && (
                  <p role="alert" className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl py-2.5 px-3">
                    ⚠️ {error}
                  </p>
                )}

                <button
                  id="tenant-login-submit"
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-white text-sm font-bold shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                  style={{ background: "var(--tenant-primary)" }}
                >
                  {loading ? "Mengecek Akun..." : "Masuk"}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-col items-center gap-2 text-center">
          <Link href={`/${tenant.slug}/kiosk`} className="text-xs font-semibold text-gray-400 hover:text-white transition-colors">
            📱 Buka Kiosk Pemesanan →
          </Link>
          <Link href="/login" className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
            Bukan outlet Anda? Cari outlet lain
          </Link>
          <span className="text-[10px] text-gray-600 mt-1">Ditenagai oleh Pesanin F&amp;B Platform</span>
        </div>
      </motion.div>
    </main>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  subtle,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`h-16 rounded-2xl text-2xl font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
        subtle
          ? "bg-transparent text-gray-400 hover:bg-white/5 text-xl"
          : "bg-white/5 border border-white/10 text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
