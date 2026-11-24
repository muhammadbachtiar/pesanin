/**
 * lib/env.ts — Resolver Environment Variable Supabase yang kompatibel dengan:
 * 1. Konvensi standar Next.js (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
 * 2. Konvensi Vercel-Supabase Integration (SUPABASE_URL, SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY)
 * 3. Runtime Injection dari Server Component RootLayout (window.__PESANIN_ENV__)
 */

declare global {
  interface Window {
    __PESANIN_ENV__?: {
      SUPABASE_URL?: string;
      SUPABASE_ANON_KEY?: string;
    };
  }
}

export function getSupabaseUrl(): string {
  const fromBuildOrServer =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  if (fromBuildOrServer) return fromBuildOrServer.trim();

  if (typeof window !== "undefined" && window.__PESANIN_ENV__?.SUPABASE_URL) {
    return window.__PESANIN_ENV__.SUPABASE_URL.trim();
  }
  return "";
}

export function getSupabaseAnonKey(): string {
  const fromBuildOrServer =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  if (fromBuildOrServer) return fromBuildOrServer.trim();

  if (typeof window !== "undefined" && window.__PESANIN_ENV__?.SUPABASE_ANON_KEY) {
    return window.__PESANIN_ENV__.SUPABASE_ANON_KEY.trim();
  }
  return "";
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    getSupabaseAnonKey() ||
    ""
  ).trim();
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}
