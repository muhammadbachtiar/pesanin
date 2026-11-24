"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const TENANT_ROLES = new Set(["kiosk", "cashier", "kitchen", "runner", "admin", "analytics", "login"]);

/**
 * PwaManager — Mengelola fitur Progressive Web App (PWA) untuk seluruh sistem:
 * 1. Registrasi Service Worker (/sw.js)
 * 2. Sinkronisasi dinamis <link rel="manifest"> per tenant & role (agar "Add to Home Screen"
 *    di tablet Kiosk langsung mengunci start_url ke /[slug]/kiosk, dan di Kasir ke /[slug]/cashier)
 * 3. Screen Wake Lock otomatis di layar Kiosk, Kasir, Dapur, dan Runner agar tablet tidak mati sendiri
 * 4. Tombol Install Aplikasi (PWA) & Tombol Fullscreen khusus Kiosk
 */
export function PwaManager() {
  const pathname = usePathname() || "/";
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Deteksi slug & role dari URL saat ini
  const segments = pathname.split("/").filter(Boolean);
  const isTenantRoute =
    segments.length >= 2 &&
    !["api", "super-admin", "admin-login", "login", "offline"].includes(segments[0]) &&
    TENANT_ROLES.has(segments[1]);
  const currentSlug = isTenantRoute ? segments[0] : null;
  const currentRole = isTenantRoute ? segments[1] : null;
  const isKioskScreen = currentRole === "kiosk";
  const isOperationalDisplay =
    currentRole === "kiosk" || currentRole === "cashier" || currentRole === "kitchen" || currentRole === "runner";

  // 1. Registrasi Service Worker & deteksi mode Standalone / iOS / Online-Offline
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration skipped:", err);
      });
    }

    const checkStandalone = () => {
      const standaloneMatch =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(standaloneMatch);
    };
    checkStandalone();

    const ua = window.navigator.userAgent.toLowerCase();
    const iosDetected = /iphone|ipad|ipod/.test(ua) || (ua.includes("mac") && "ontouchend" in document);
    setIsIos(iosDetected);

    const dismissedKey = `pesanin_pwa_dismissed_${currentSlug || "root"}_${currentRole || "app"}`;
    setBannerDismissed(sessionStorage.getItem(dismissedKey) === "1");

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    setIsOffline(!navigator.onLine);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [currentSlug, currentRole]);

  // 2. Update <link rel="manifest"> secara dinamis sesuai Tenant & Role
  useEffect(() => {
    if (typeof document === "undefined") return;

    const targetHref =
      currentSlug && currentRole
        ? `/api/manifest?slug=${encodeURIComponent(currentSlug)}&role=${encodeURIComponent(currentRole)}`
        : "/manifest.webmanifest";

    let linkEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.rel = "manifest";
      document.head.appendChild(linkEl);
    }
    if (linkEl.getAttribute("href") !== targetHref) {
      linkEl.setAttribute("href", targetHref);
    }
  }, [currentSlug, currentRole]);

  // 3. Screen Wake Lock untuk layar Kiosk, Kasir, Dapur (KDS) & Runner agar layar tablet tidak mati sendiri
  useEffect(() => {
    if (typeof window === "undefined" || !isOperationalDisplay) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.wakeLock) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wakeLockSentinel: any = null;

    const requestWakeLock = async () => {
      try {
        if (document.visibilityState === "visible") {
          wakeLockSentinel = await nav.wakeLock.request("screen");
        }
      } catch {
        // Wake lock dapat ditolak jika baterai lemah
      }
    };

    requestWakeLock();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [isOperationalDisplay]);

  const handleInstallClick = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } else if (isIos) {
      setShowIosGuide(true);
    }
  }, [deferredPrompt, isIos]);

  const dismissBanner = useCallback(() => {
    const dismissedKey = `pesanin_pwa_dismissed_${currentSlug || "root"}_${currentRole || "app"}`;
    sessionStorage.setItem(dismissedKey, "1");
    setBannerDismissed(true);
  }, [currentSlug, currentRole]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Abaikan jika perangkat tidak mendukung Fullscreen API
    }
  }, []);

  const canShowInstallPill = !isStandalone && !bannerDismissed && (Boolean(deferredPrompt) || isIos);

  return (
    <>
      {/* Indikator Jaringan Terputus (Realtime Offline Toast) */}
      {isOffline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] bg-rose-600 text-white px-4 py-2 rounded-full shadow-xl text-xs font-extrabold flex items-center gap-2 animate-bounce">
          <span>📡</span>
          <span>Koneksi Internet Terputus — Menunggu Sinyal Kembali...</span>
        </div>
      )}

      {/* Tombol Fullscreen Discreet Khusus Kiosk Tablet */}
      {isKioskScreen && !isStandalone && (
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Keluar Layar Penuh" : "Mode Layar Penuh Kiosk"}
          className="fixed bottom-3 right-3 z-50 w-9 h-9 rounded-full bg-gray-900/65 hover:bg-gray-900 text-white backdrop-blur-md shadow-md border border-white/15 flex items-center justify-center text-sm cursor-pointer transition-all"
        >
          {isFullscreen ? "🗗" : "⛶"}
        </button>
      )}

      {/* Floating Pill Install Aplikasi PWA (Muncul saat belum di-install ke Home Screen) */}
      {canShowInstallPill && isTenantRoute && (
        <div className="fixed bottom-3 right-14 z-50 flex items-center gap-1.5 bg-gray-950/90 text-white backdrop-blur-md pl-3 pr-2 py-1.5 rounded-full shadow-xl border border-white/15 text-xs">
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 font-extrabold hover:text-indigo-300 transition-colors cursor-pointer"
          >
            <span>📲</span>
            <span>
              Pasang Aplikasi {currentRole === "kiosk" ? "Kiosk" : currentRole === "cashier" ? "Kasir" : "Outlet"}
            </span>
          </button>
          <button
            type="button"
            onClick={dismissBanner}
            aria-label="Tutup saran install"
            className="w-5 h-5 rounded-full hover:bg-white/15 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer ml-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Panduan Install PWA untuk iPad / iPhone (Safari iOS) */}
      {showIosGuide && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowIosGuide(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-gray-900 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-black text-base">📲 Pasang di iPad / iPhone</h3>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="text-gray-400 hover:text-gray-700 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            <ol className="text-xs text-gray-600 space-y-2.5 list-decimal list-inside font-medium leading-relaxed">
              <li>
                Ketuk ikon <strong>Bagikan (Share ⬆️)</strong> di bilah browser Safari.
              </li>
              <li>
                Pilih <strong>&ldquo;Tambahkan ke Layar Utama&rdquo; (Add to Home Screen ➕)</strong>.
              </li>
              <li>
                Ketuk <strong>Tambah (Add)</strong> di pojok kanan atas untuk membuka layar ini secara penuh tanpa bilah URL.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 rounded-xl bg-gray-900 text-white font-bold text-xs cursor-pointer"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}
    </>
  );
}
