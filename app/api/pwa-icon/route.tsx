import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * Generator ikon PNG dinamis (192x192 & 512x512) untuk PWA Multi-Tenant.
 * Contoh URL: /api/pwa-icon?size=192&color=%234f46e5&label=KP
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawSize = Number(searchParams.get("size") || "192");
  const size = rawSize === 512 ? 512 : 192;
  const color = searchParams.get("color") || "#4f46e5";
  const rawLabel = (searchParams.get("label") || "P").trim().slice(0, 2).toUpperCase();
  const label = rawLabel || "P";

  const fontSize = Math.round(size * (label.length > 1 ? 0.42 : 0.52));
  const borderRadius = Math.round(size * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: color,
          borderRadius,
          color: "#ffffff",
          fontFamily: "sans-serif",
          fontWeight: 900,
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {label}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: Math.round(size * 0.1),
            fontSize: Math.round(size * 0.085),
            fontWeight: 700,
            opacity: 0.85,
            letterSpacing: "0.1em",
          }}
        >
          PESANIN
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
    }
  );
}
