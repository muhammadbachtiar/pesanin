/**
 * GET /api/public/tenants?q=kopi
 *
 * Pencarian outlet publik untuk halaman login (staf yang lupa URL outlet).
 * Hanya mengembalikan data non-sensitif: name, slug, subtitle, logo_url.
 * Minimal 2 karakter, maksimal 8 hasil. Hanya tenant aktif.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) return NextResponse.json({ tenants: [] });

  // Buang karakter yang bermakna di filter PostgREST (.or) agar tidak bisa disisipi
  const q = raw.replace(/[%,()*\\]/g, " ").slice(0, 40).trim();
  if (q.length < 2) return NextResponse.json({ tenants: [] });

  const { data, error } = await createSupabaseAdminClient()
    .from("tenants")
    .select("name, slug, subtitle, logo_url")
    .eq("is_active", true)
    .or(`name.ilike.%${q}%,slug.ilike.%${q}%`)
    .order("name")
    .limit(8);

  if (error) return NextResponse.json({ tenants: [] });
  return NextResponse.json({ tenants: data ?? [] });
}
