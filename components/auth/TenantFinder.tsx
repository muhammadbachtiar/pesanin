"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SearchOutlined, ShopOutlined, ArrowRightOutlined } from "@ant-design/icons";

interface TenantHit {
  name: string;
  slug: string;
  subtitle: string | null;
  logo_url: string | null;
}

/**
 * TenantFinder — cari outlet berdasarkan nama untuk menuju /[slug]/login.
 * Untuk staf yang tidak hafal URL outlet mereka.
 * `theme` menyesuaikan latar halaman pemakai (terang / gelap).
 */
export function TenantFinder({ theme = "light" }: { theme?: "light" | "dark" }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TenantHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/tenants?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json();
        setHits(data.tenants ?? []);
        setSearched(true);
      } catch {
        /* aborted / network error — abaikan */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const dark = theme === "dark";

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${dark ? "text-gray-500" : "text-gray-400"}`}>
          <SearchOutlined className="text-sm" />
        </span>
        <input
          id="tenant-finder-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ketik nama restoran / outlet Anda…"
          autoComplete="off"
          className={`w-full pl-10 pr-4 py-3 rounded-xl border outline-none text-sm font-medium transition-all focus:ring-4 ${
            dark
              ? "bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-indigo-400 focus:ring-indigo-500/20"
              : "bg-gray-50/50 border-gray-200 text-gray-950 placeholder-gray-400 focus:border-indigo-600 focus:bg-white focus:ring-indigo-500/10"
          }`}
        />
        {loading && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <span className="block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </span>
        )}
      </div>

      {hits.length > 0 && (
        <ul className="space-y-2">
          {hits.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/${t.slug}/login`}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all group ${
                  dark
                    ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-indigo-400/50"
                    : "bg-white border-gray-200 hover:border-indigo-400 hover:shadow-md"
                }`}
              >
                {t.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.logo_url} alt={t.name} className="w-10 h-10 rounded-lg object-contain bg-white border border-gray-100 p-1" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white">
                    <ShopOutlined />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold truncate ${dark ? "text-white" : "text-gray-900"}`}>{t.name}</div>
                  <div className={`text-xs truncate ${dark ? "text-gray-400" : "text-gray-500"}`}>
                    {t.subtitle || `/${t.slug}`}
                  </div>
                </div>
                <ArrowRightOutlined className={`text-xs transition-transform group-hover:translate-x-1 ${dark ? "text-gray-400" : "text-gray-400"}`} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {searched && !loading && hits.length === 0 && (
        <p className={`text-xs text-center py-2 ${dark ? "text-gray-400" : "text-gray-500"}`}>
          Outlet tidak ditemukan. Periksa ejaan atau tanyakan Admin Outlet Anda.
        </p>
      )}
    </div>
  );
}
