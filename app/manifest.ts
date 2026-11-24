import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pesanin — Cloud POS & Self-Order Kiosk",
    short_name: "Pesanin POS",
    description: "Sistem Kasir POS, Self-Order Kiosk, Kitchen Display (KDS) & Runner Multi-Tenant",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#09090b",
    theme_color: "#4f46e5",
    categories: ["business", "food", "productivity"],
    icons: [
      {
        src: "/api/pwa-icon?size=192&color=%234f46e5&label=P",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/pwa-icon?size=512&color=%234f46e5&label=P",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/pwa-icon?size=512&color=%234f46e5&label=P",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
