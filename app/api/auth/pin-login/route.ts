/**
 * POST /api/auth/pin-login
 *
 * Quick PIN login untuk staf operasional (CASHIER / KITCHEN / RUNNER).
 *
 * Body : { slug: string, profileId: string, pin: string }
 * Alur :
 *   1. Validasi tenant (slug aktif) & profile (aktif, milik tenant tsb, role eligible)
 *   2. Cek lockout + verifikasi PIN (scrypt) dari tabel staff_pins
 *   3. Salah  → naikkan failed_attempts, kunci 5 menit setelah 5x salah
 *      Benar  → reset counter, terbitkan session Supabase asli lewat
 *               admin.generateLink (token_hash) + verifyOtp → cookie session
 *
 * Session yang dihasilkan identik dengan login email/password, sehingga RLS,
 * TenantRoleGuard, dan middleware bekerja tanpa perubahan.
 */

import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/serverAuth";
import { isValidPin, verifyPin, PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from "@/lib/pin";
import { PIN_ELIGIBLE_ROLES, getRoleHome } from "@/lib/rolePaths";
import type { UserRole } from "@/types";

const GENERIC_FAIL = "Staf atau PIN tidak valid.";

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

export async function POST(req: NextRequest) {
  try {
    const { slug, profileId, pin } = (await req.json()) as {
      slug?: string;
      profileId?: string;
      pin?: string;
    };

    if (!slug || !profileId || !isValidPin(pin)) {
      return NextResponse.json({ error: "PIN harus 4–6 digit angka." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // 1. Tenant & profile
    const { data: tenant } = await admin
      .from("tenants")
      .select("id, slug, business_logic")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();
    if (!tenant) return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });

    const { data: profile } = await admin
      .from("profiles")
      .select("id, user_id, tenant_id, role, is_active")
      .eq("id", profileId)
      .single();

    if (
      !profile ||
      !profile.is_active ||
      profile.tenant_id !== tenant.id ||
      !PIN_ELIGIBLE_ROLES.includes(profile.role as UserRole)
    ) {
      return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
    }

    // 2. Lockout + verifikasi PIN
    const { data: pinRow } = await admin
      .from("staff_pins")
      .select("pin_hash, failed_attempts, locked_until")
      .eq("profile_id", profile.id)
      .single();

    if (!pinRow) {
      return NextResponse.json(
        { error: "PIN belum diatur untuk akun ini. Hubungi Admin Outlet." },
        { status: 401 }
      );
    }

    if (pinRow.locked_until && new Date(pinRow.locked_until).getTime() > Date.now()) {
      const minutes = Math.ceil((new Date(pinRow.locked_until).getTime() - Date.now()) / 60000);
      return NextResponse.json(
        { error: `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`, locked: true },
        { status: 429 }
      );
    }

    if (!verifyPin(pin, pinRow.pin_hash)) {
      const attempts = (pinRow.failed_attempts ?? 0) + 1;
      const shouldLock = attempts >= PIN_MAX_ATTEMPTS;
      await admin
        .from("staff_pins")
        .update({
          failed_attempts: shouldLock ? 0 : attempts,
          locked_until: shouldLock
            ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString()
            : null,
        })
        .eq("profile_id", profile.id);

      return NextResponse.json(
        shouldLock
          ? { error: `PIN salah ${PIN_MAX_ATTEMPTS}x. Akun dikunci ${PIN_LOCK_MINUTES} menit.`, locked: true }
          : { error: `PIN salah. Sisa percobaan: ${PIN_MAX_ATTEMPTS - attempts}.` },
        { status: shouldLock ? 429 : 401 }
      );
    }

    // 3. PIN benar → reset counter & terbitkan session
    await admin
      .from("staff_pins")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("profile_id", profile.id);

    const { data: authUser, error: userErr } = await admin.auth.admin.getUserById(profile.user_id);
    if (userErr || !authUser?.user?.email) {
      return NextResponse.json({ error: "Akun login tidak ditemukan." }, { status: 500 });
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error("[pin-login] generateLink gagal:", linkErr);
      return NextResponse.json({ error: "Gagal membuat sesi login." }, { status: 500 });
    }

    const cookiesToSet: CookieToSet[] = [];
    const sbSession = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return req.cookies.getAll(); },
          setAll(toSet) {
            toSet.forEach((c) => cookiesToSet.push(c as CookieToSet));
          },
        },
      }
    );

    const { error: verifyErr } = await sbSession.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    if (verifyErr) {
      console.error("[pin-login] verifyOtp gagal:", verifyErr);
      return NextResponse.json({ error: "Gagal membuat sesi login." }, { status: 500 });
    }

    const res = NextResponse.json({
      success: true,
      role: profile.role,
      redirect: getRoleHome(profile.role as UserRole, tenant.slug),
    });
    cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
    return res;
  } catch (err) {
    console.error("[API /auth/pin-login]", err);
    return NextResponse.json({ error: "Terjadi kesalahan sistem." }, { status: 500 });
  }
}
