"use client";

import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setTimeout(() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = "/";
        }
      }, 800);
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return (
    <main className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6 font-sans text-center">
      <div className="max-w-md w-full bg-white/[0.04] border border-white/10 rounded-3xl p-8 shadow-2xl space-y-5">
        <div className="w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center text-4xl mx-auto">
          {isOnline ? "✅" : "📡"}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight">
            {isOnline ? "Koneksi Tersambung Kembali!" : "Koneksi Wi-Fi / Internet Terputus"}
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            {isOnline
              ? "Mengembalikan Anda ke layar operasional..."
              : "Perangkat tidak dapat terhubung ke server Pesanin. Pastikan Wi-Fi atau jaringan internet outlet menyala. Layar ini akan otomatis kembali begitu sinyal pulih."}
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white font-extrabold text-sm shadow-lg transition-all cursor-pointer"
          >
            🔄 Coba Hubungkan Sekarang
          </button>
        </div>
      </div>
    </main>
  );
}
