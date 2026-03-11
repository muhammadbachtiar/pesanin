"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { signIn, getCurrentProfile } from "@/services/authService";
import { getSupabaseClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } = await signIn(email, password);
    if (authError) {
      setError("Email atau password salah.");
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
      if (!slug) { setError("Konfigurasi tenant tidak ditemukan."); setLoading(false); return; }
      if (profile.role === "CASHIER") router.push(`/${slug}/cashier`);
      else if (profile.role === "KITCHEN") router.push(`/${slug}/kitchen`);
      else if (profile.role === "OWNER") router.push(`/${slug}/admin`);
      else router.push(`/${slug}/kiosk`);
    }
    setLoading(false);
  };


  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}
    >
      <motion.div
        className="card p-8 w-full max-w-sm"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 20 }}
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black" style={{ color: "var(--color-text)" }}>
            Pesanin
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            Masuk ke akun Anda
          </p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 outline-none focus:border-indigo-400 transition-colors"
              style={{ borderColor: "var(--color-border)" }}
              placeholder="kasir@kafe.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 outline-none focus:border-indigo-400 transition-colors"
              style={{ borderColor: "var(--color-border)" }}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}
          <motion.button
            type="submit"
            disabled={loading}
            whileTap={{ scale: 0.97 }}
            className="btn-primary w-full py-3 rounded-xl"
            style={{ background: "#6366f1", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Masuk..." : "Masuk"}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}
