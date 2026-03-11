"use client";

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let _client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Singleton browser client — session disimpan di COOKIES bukan localStorage.
 * Wajib dipakai agar middleware server bisa membaca session.
 */
export function getSupabaseClient() {
  if (typeof window === "undefined") {
    // Di server context, buat fresh instance (tidak di-cache)
    return createBrowserClient(url, anonKey);
  }
  if (!_client) _client = createBrowserClient(url, anonKey);
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
