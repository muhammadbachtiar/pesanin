import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTenantBySlugServer } from "@/services/tenantServiceServer";
import { createSupabaseAdminClient } from "@/lib/serverAuth";
import { PIN_ELIGIBLE_ROLES } from "@/lib/rolePaths";
import TenantLoginClient, { type LoginStaff } from "./TenantLoginClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ tenant_slug: string }> }): Promise<Metadata> {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  return {
    title: tenant ? `Masuk — ${tenant.name}` : "Masuk Outlet",
    description: tenant
      ? `Portal login staf ${tenant.name}: masuk cepat dengan PIN atau email.`
      : "Portal login staf outlet Pesanin.",
  };
}

/**
 * Halaman login ber-branding outlet.
 * Daftar staf (nama + role) hanya mencakup staf AKTIF yang sudah punya PIN —
 * tidak ada email / id auth / hash yang dikirim ke browser.
 */
export default async function TenantLoginPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  if (!tenant) notFound();

  const admin = createSupabaseAdminClient();
  const posOnly = tenant.business_logic?.pos_only ?? false;
  const roles = PIN_ELIGIBLE_ROLES.filter((r) => !(posOnly && (r === "KITCHEN" || r === "RUNNER")));

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .in("role", roles)
    .order("full_name");

  let staff: LoginStaff[] = [];
  if (profiles && profiles.length > 0) {
    const { data: pinRows } = await admin
      .from("staff_pins")
      .select("profile_id")
      .in("profile_id", profiles.map((p) => p.id));
    const withPin = new Set((pinRows ?? []).map((r) => r.profile_id));
    staff = profiles.filter((p) => withPin.has(p.id)) as LoginStaff[];
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b]" />}>
      <TenantLoginClient
        tenant={{
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          subtitle: tenant.subtitle,
          logo_url: tenant.logo_url,
        }}
        staff={staff}
      />
    </Suspense>
  );
}
