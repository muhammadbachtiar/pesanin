import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getTenantBySlugServer } from "@/services/tenantServiceServer";

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export async function generateViewport({
  params,
}: {
  params: Promise<{ tenant_slug: string }>;
}): Promise<Viewport> {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  return {
    themeColor: tenant?.visual_config?.primary_color || "#4f46e5",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant_slug: string }>;
}): Promise<Metadata> {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  if (!tenant) {
    return { title: "Outlet Tidak Ditemukan — Pesanin" };
  }

  const primaryColor = encodeURIComponent(tenant.visual_config?.primary_color || "#4f46e5");
  const initials = encodeURIComponent(getInitials(tenant.name));
  const iconUrl = `/api/pwa-icon?size=192&color=${primaryColor}&label=${initials}`;

  return {
    title: `${tenant.name} — Pesanin POS & Kiosk`,
    description: tenant.description || tenant.subtitle || `Sistem Pemesanan & Kasir ${tenant.name}`,
    manifest: `/api/manifest?slug=${encodeURIComponent(tenant.slug)}&role=kiosk`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: tenant.name,
    },
    icons: {
      icon: iconUrl,
      apple: iconUrl,
    },
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant_slug: string }>;
}) {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  if (!tenant) notFound();

  const { primary_color, secondary_color } = tenant.visual_config;

  return (
    <>
      <style>{`
        :root {
          --tenant-primary: ${primary_color};
          --tenant-secondary: ${secondary_color};
        }
      `}</style>
      {children}
    </>
  );
}
