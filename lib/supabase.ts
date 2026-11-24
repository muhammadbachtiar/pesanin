"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";

let _client: ReturnType<typeof createBrowserClient> | null = null;
let _cachedUrl = "";

/**
 * Singleton browser client — session disimpan di COOKIES bukan localStorage.
 * Wajib dipakai agar middleware server bisa membaca session.
 *
 * Mendukung pembacaan env var baik dari build-time Next.js (NEXT_PUBLIC_*)
 * maupun dari runtime server injection (window.__PESANIN_ENV__) di Vercel.
 */
export function getSupabaseClient() {
  const currentUrl = getSupabaseUrl() || "https://missing-supabase-url-in-vercel.supabase.co";
  const currentAnonKey = getSupabaseAnonKey() || "missing-supabase-anon-key-in-vercel";

  if (currentUrl.includes("missing-supabase-url-in-vercel") && typeof window !== "undefined") {
    console.error(
      "[Pesanin] Environment Variable NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY belum ditemukan di Vercel. " +
        "Tambahkan di Vercel Dashboard -> Settings -> Environment Variables lalu klik Redeploy."
    );
  }

  if (typeof window === "undefined") {
    return createBrowserClient(currentUrl, currentAnonKey);
  }
  if (!_client || _cachedUrl !== currentUrl) {
    _client = createBrowserClient(currentUrl, currentAnonKey);
    _cachedUrl = currentUrl;
  }
  return _client;
}

/**
 * Alias: export `supabase` agar kode lama tidak perlu diubah semua.
 * Ini adalah Proxy yang forward semua method ke getSupabaseClient().
 */
export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === "function") return val.bind(client);
    return val;
  },
});
