import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaManager } from "@/components/PwaManager";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Pesanin — Cloud POS & Self-Order Kiosk",
  description: "Multi-tenant food & beverage POS, Kiosk, Kitchen Display (KDS), and Runner platform",
  applicationName: "Pesanin POS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pesanin POS",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/api/pwa-icon?size=192&color=%234f46e5&label=P",
    apple: "/api/pwa-icon?size=192&color=%234f46e5&label=P",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Baca URL & Anon Key Supabase di Server Runtime (mendukung NEXT_PUBLIC_SUPABASE_URL maupun SUPABASE_URL di Vercel)
  // lalu suntikkan ke window.__PESANIN_ENV__ agar Client Components selalu memperoleh kredensial publik meskipun
  // env var di Vercel baru ditambahkan setelah build atau memakai penamaan integrasi Supabase.
  const runtimeUrl = getSupabaseUrl();
  const runtimeAnonKey = getSupabaseAnonKey();
  const envPayload = JSON.stringify({
    SUPABASE_URL: runtimeUrl,
    SUPABASE_ANON_KEY: runtimeAnonKey,
  });

  return (
    <html lang="id">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__PESANIN_ENV__=${envPayload};`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <PwaManager />
      </body>
    </html>
  );
}
