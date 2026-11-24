import { NextResponse } from "next/server";
import { getTenantBySlugServer } from "@/services/tenantServiceServer";

const ROLE_TITLE_MAP: Record<string, { suffix: string; shortPrefix: string }> = {
  kiosk: { suffix: "Self-Order Kiosk", shortPrefix: "Kiosk" },
  cashier: { suffix: "Kasir POS", shortPrefix: "Kasir" },
  kitchen: { suffix: "Layar Dapur (KDS)", shortPrefix: "Dapur" },
  runner: { suffix: "Layar Runner", shortPrefix: "Runner" },
  admin: { suffix: "Portal Owner", shortPrefix: "Admin" },
  analytics: { suffix: "Analytics Owner", shortPrefix: "Analytics" },
  login: { suffix: "Portal Staf", shortPrefix: "Staf" },
};

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Dynamic Multi-Tenant & Role-Aware Web App Manifest
 * Contoh: /api/manifest?slug=kafe-demo&role=kiosk
 *
 * Saat tablet Kiosk di-install ke Home Screen ("Add to Home Screen"),
 * aplikasi akan langsung membuka `/[slug]/kiosk` secara fullscreen/standalone
 * dengan nama, warna tema, dan ikon inisial kafe tersebut.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = (searchParams.get("slug") || "").trim();
  const role = (searchParams.get("role") || "kiosk").trim().toLowerCase();

  if (!slug) {
    return NextResponse.redirect(new URL("/manifest.webmanifest", req.url));
  }

  const tenant = await getTenantBySlugServer(slug);
  const tenantName = tenant?.name || slug;
  const primaryColor = tenant?.visual_config?.primary_color || "#4f46e5";
  const initials = getInitials(tenantName);
  const roleMeta = ROLE_TITLE_MAP[role] || ROLE_TITLE_MAP.kiosk;

  const validRolePath = Object.keys(ROLE_TITLE_MAP).includes(role) ? role : "kiosk";
  const startUrl = `/${slug}/${validRolePath}`;
  const encodedColor = encodeURIComponent(primaryColor);
  const encodedLabel = encodeURIComponent(initials);

  const manifestPayload = {
    id: `${slug}-${validRolePath}`,
    name: `${tenantName} — ${roleMeta.suffix}`,
    short_name: `${roleMeta.shortPrefix} ${tenantName}`.slice(0, 24),
    description: `${roleMeta.suffix} untuk ${tenantName} (Powered by Pesanin)`,
    start_url: startUrl,
    scope: `/${slug}/`,
    display: validRolePath === "kiosk" ? "fullscreen" : "standalone",
    display_override: validRolePath === "kiosk" ? ["fullscreen", "standalone"] : ["standalone"],
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: primaryColor,
    categories: ["food", "business", "productivity"],
    icons: [
      {
        src: `/api/pwa-icon?size=192&color=${encodedColor}&label=${encodedLabel}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/pwa-icon?size=512&color=${encodedColor}&label=${encodedLabel}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/pwa-icon?size=512&color=${encodedColor}&label=${encodedLabel}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Kiosk Self-Order",
        short_name: "Kiosk",
        url: `/${slug}/kiosk`,
        icons: [{ src: `/api/pwa-icon?size=192&color=${encodedColor}&label=K`, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Layar Kasir POS",
        short_name: "Kasir",
        url: `/${slug}/cashier`,
        icons: [{ src: `/api/pwa-icon?size=192&color=${encodedColor}&label=C`, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Layar Dapur (KDS)",
        short_name: "Dapur",
        url: `/${slug}/kitchen`,
        icons: [{ src: `/api/pwa-icon?size=192&color=${encodedColor}&label=D`, sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Portal Admin Owner",
        short_name: "Owner",
        url: `/${slug}/admin`,
        icons: [{ src: `/api/pwa-icon?size=192&color=${encodedColor}&label=A`, sizes: "192x192", type: "image/png" }],
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifestPayload), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
