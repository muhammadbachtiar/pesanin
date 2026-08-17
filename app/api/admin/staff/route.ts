/**
 * API Route: /api/admin/staff
 *
 * Endpoint untuk membuat akun staf baru (auth.users + profiles).
 * Memerlukan SUPABASE_SERVICE_ROLE_KEY (tidak pernah di-expose ke client).
 *
 * Hak akses:
 *   - SUPER_ADMIN: bisa buat semua role (OWNER, CASHIER, KITCHEN, RUNNER)
 *   - OWNER      : hanya bisa buat CASHIER, KITCHEN, RUNNER di tenant sendiri
 *
 * Body (POST):
 *   { email, password, fullName, role, tenantId }
 *
 * Response:
 *   { success: true, profileId: "..." }
 *   { error: "..." }
 */

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/types";

// Role yang boleh dibuat oleh OWNER (tidak termasuk OWNER/SUPER_ADMIN)
const OWNER_ALLOWED_ROLES: UserRole[] = ["CASHIER", "KITCHEN", "RUNNER"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, fullName, role, tenantId } = body as {
      email: string;
      password: string;
      fullName: string;
      role: UserRole;
      tenantId: string | null;
    };

    // ── Validasi input dasar ──────────────────────────────────────────
    if (!email || !password || !role) {
      return NextResponse.json({ error: "email, password, dan role wajib diisi" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password minimal 8 karakter" }, { status: 400 });
    }

    // ── Verifikasi session pemohon (server-side) ──────────────────────
    const response = NextResponse.next();
    const sbSession = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll(); },
          setAll(toSet) {
            toSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data: { user: requester } } = await sbSession.auth.getUser();
    if (!requester) {
      return NextResponse.json({ error: "Unauthorized — silakan login terlebih dahulu" }, { status: 401 });
    }

    // Ambil profile pemohon untuk cek role & tenant_id
    const { data: requesterProfile } = await sbSession
      .from("profiles")
      .select("role, tenant_id")
      .eq("user_id", requester.id)
      .eq("is_active", true)
      .single();

    if (!requesterProfile) {
      return NextResponse.json({ error: "Profile pemohon tidak ditemukan" }, { status: 403 });
    }

    const requesterRole = requesterProfile.role as UserRole;
    const requesterTenantId = requesterProfile.tenant_id as string | null;

    // ── Validasi hak pemohon ──────────────────────────────────────────
    if (requesterRole === "OWNER") {
      // OWNER hanya bisa buat staf untuk tenant-nya sendiri
      if (!tenantId || tenantId !== requesterTenantId) {
        return NextResponse.json({ error: "OWNER hanya bisa menambah staf di outlet sendiri" }, { status: 403 });
      }
      if (!OWNER_ALLOWED_ROLES.includes(role)) {
        return NextResponse.json({ error: `OWNER tidak bisa membuat akun dengan role ${role}` }, { status: 403 });
      }
    } else if (requesterRole === "SUPER_ADMIN") {
      // SUPER_ADMIN wajib sertakan tenantId kecuali membuat SUPER_ADMIN lain
      if (role !== "SUPER_ADMIN" && !tenantId) {
        return NextResponse.json({ error: "tenantId wajib diisi untuk role selain SUPER_ADMIN" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Anda tidak memiliki hak untuk membuat akun staf" }, { status: 403 });
    }

    // ── Gunakan Service Role Key untuk buat user Auth ─────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server configuration error: service key missing" }, { status: 500 });
    }

    const adminSb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Buat akun Auth
    const { data: newUser, error: createError } = await adminSb.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Langsung aktif tanpa perlu klik email konfirmasi
    });

    if (createError || !newUser?.user) {
      const msg = createError?.message ?? "Gagal membuat akun";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Insert profile
    const { data: newProfile, error: profileError } = await adminSb
      .from("profiles")
      .insert({
        user_id: newUser.user.id,
        tenant_id: tenantId ?? null,
        full_name: fullName || null,
        role,
        is_active: true,
      })
      .select("id")
      .single();

    if (profileError || !newProfile) {
      // Rollback: hapus user auth jika profile gagal dibuat
      await adminSb.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json({ error: "Gagal menyimpan profil staf" }, { status: 500 });
    }

    return NextResponse.json({ success: true, profileId: newProfile.id });
  } catch (err) {
    console.error("[API /admin/staff POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** GET — Ambil daftar staf berdasarkan tenantId (query param) */
export async function GET(req: NextRequest) {
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId");

    const response = NextResponse.next();
    const sbSession = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll(); },
          setAll(toSet) {
            toSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data: { user: requester } } = await sbSession.auth.getUser();
    if (!requester) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: requesterProfile } = await sbSession
      .from("profiles")
      .select("role, tenant_id")
      .eq("user_id", requester.id)
      .eq("is_active", true)
      .single();

    if (!requesterProfile) {
      return NextResponse.json({ error: "Profile tidak ditemukan" }, { status: 403 });
    }

    const requesterRole = requesterProfile.role as UserRole;
    const requesterTenantId = requesterProfile.tenant_id as string | null;

    // Validasi: OWNER hanya bisa lihat staf tenant sendiri
    if (requesterRole === "OWNER") {
      if (!tenantId || tenantId !== requesterTenantId) {
        return NextResponse.json({ error: "Tidak diizinkan melihat staf tenant lain" }, { status: 403 });
      }
    } else if (requesterRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const adminSb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let query = adminSb.from("profiles").select("*").eq("is_active", true);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (requesterRole === "OWNER") {
      // OWNER hanya lihat staf-nya, bukan akun OWNER/SA
      query = query.in("role", ["CASHIER", "KITCHEN", "RUNNER"]);
    }

    const { data, error } = await query.order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ staff: data });
  } catch (err) {
    console.error("[API /admin/staff GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH — Toggle is_active staf (aktifkan/nonaktifkan) */
export async function PATCH(req: NextRequest) {
  try {
    const { profileId, isActive } = await req.json() as { profileId: string; isActive: boolean };
    if (!profileId) return NextResponse.json({ error: "profileId wajib diisi" }, { status: 400 });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return NextResponse.json({ error: "Server config error" }, { status: 500 });

    const adminSb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error } = await adminSb
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", profileId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API /admin/staff PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
