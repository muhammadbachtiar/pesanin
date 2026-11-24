"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getQuickNoteGroups, isQuickNoteActive, toggleQuickNote } from "@/lib/quickNotes";

export interface QuickNoteChipsProps {
  product: { name: string; description?: string | null; labels?: string[] | null };
  categoryName?: string | null;
  /** Teks catatan saat ini */
  value: string;
  /** Callback ketika catatan berubah akibat klik chip */
  onChange: (next: string) => void;
  /** Tampilkan grup penyajian (bungkus terpisah, sendok, dll.) untuk takeaway */
  includePackaging?: boolean;
  /** "lg" untuk modal detail Kiosk, "sm" untuk baris keranjang Kiosk & Kasir */
  size?: "sm" | "lg";
  /** Callback opsional untuk menutup panel */
  onClose?: () => void;
}

/**
 * Panel chip rekomendasi ringkas dengan Tab Kategori (hanya menampilkan 1 baris chip per tab)
 * sehingga tidak pernah membuat daftar menu memanjang ke bawah.
 */
export function QuickNoteChips({
  product,
  categoryName,
  value,
  onChange,
  includePackaging = false,
  size = "sm",
  onClose,
}: QuickNoteChipsProps) {
  const groups = useMemo(
    () => getQuickNoteGroups(product, categoryName, includePackaging),
    [product, categoryName, includePackaging]
  );

  const [activeGroupId, setActiveGroupId] = useState<string>(() => groups[0]?.id ?? "");

  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.id === activeGroupId)) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);

  if (groups.length === 0) return null;

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  const isLg = size === "lg";

  const handleSelectOption = (opt: string) => {
    const wasActive = isQuickNoteActive(value, opt);
    const nextValue = toggleQuickNote(value, opt, activeGroup);
    onChange(nextValue);

    // Smart Auto-Advance: Jika user memilih opsi pada grup eksklusif (mis. pilih "Less Sugar" di tab Gula),
    // otomatis berpindah ke tab berikutnya (mis. tab "Es") agar user bisa klik beruntun dengan cepat.
    if (!wasActive && activeGroup.exclusive && groups.length > 1) {
      const currentIdx = groups.findIndex((g) => g.id === activeGroup.id);
      if (currentIdx >= 0 && currentIdx < groups.length - 1) {
        setTimeout(() => {
          setActiveGroupId(groups[currentIdx + 1].id);
        }, 110);
      }
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        // Cegah input kehilangan fokus saat pengguna mengetuk tab atau chip
        e.preventDefault();
      }}
      className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-2 shadow-xs space-y-1.5"
    >
      {/* Header Bar: Segmented Category Tabs + Tombol Selesai */}
      <div className="flex items-center justify-between gap-1.5 border-b border-indigo-100/80 pb-1.5">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-extrabold text-indigo-500 px-1 flex-shrink-0"></span>
          {groups.map((g) => {
            const isTabActive = g.id === activeGroup.id;
            const hasPickedInGroup = g.options.some((opt) => isQuickNoteActive(value, opt));
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGroupId(g.id)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer ${
                  isTabActive
                    ? "bg-white text-gray-900 shadow-2xs border border-gray-200/80"
                    : "text-gray-500 hover:text-gray-800 hover:bg-white/50"
                }`}
              >
                <span>{g.label}</span>
                {hasPickedInGroup && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--tenant-primary, #4f46e5)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {value.trim() && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[10px] font-bold text-rose-500 hover:text-rose-700 px-1.5 py-0.5 rounded hover:bg-rose-50 cursor-pointer"
            >
              Reset
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-extrabold text-indigo-600 bg-white hover:bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md cursor-pointer"
            >
              Selesai ✓
            </button>
          )}
        </div>
      </div>

      {/* Baris Chip Ringkas untuk Tab yang Sedang Aktif */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {activeGroup.options.map((opt) => {
          const active = isQuickNoteActive(value, opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => handleSelectOption(opt)}
              className={`${
                isLg ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
              } rounded-lg font-bold border transition-all active:scale-95 cursor-pointer select-none ${
                active
                  ? "text-white border-transparent shadow-2xs"
                  : "bg-white text-gray-700 border-gray-200/90 hover:border-gray-400"
              }`}
              style={active ? { background: "var(--tenant-primary, #4f46e5)" } : undefined}
            >
              {active ? "✓ " : "+ "}
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface QuickNoteInputProps {
  product: { name: string; description?: string | null; labels?: string[] | null };
  categoryName?: string | null;
  value: string;
  onChange: (next: string) => void;
  includePackaging?: boolean;
  placeholder?: string;
  size?: "sm" | "lg";
  multiline?: boolean;
  onFocusScroll?: boolean;
}

/**
 * QuickNoteInput — Input catatan interaktif yang HANYA menampilkan panel chip rekomendasi
 * ketika pengguna mengklik / memfokuskan input catatan tersebut, dan otomatis menutup
 * ketika pengguna selesai atau mengklik di luar.
 */
export function QuickNoteInput({
  product,
  categoryName,
  value,
  onChange,
  includePackaging = false,
  placeholder = "Tambah catatan (klik untuk opsi cepat)...",
  size = "sm",
  multiline = false,
  onFocusScroll = false,
}: QuickNoteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const groups = useMemo(
    () => getQuickNoteGroups(product, categoryName, includePackaging),
    [product, categoryName, includePackaging]
  );

  // Hitung berapa chip rekomendasi yang sedang aktif di nilai catatan
  const activeChipCount = useMemo(() => {
    let count = 0;
    groups.forEach((g) => {
      g.options.forEach((opt) => {
        if (isQuickNoteActive(value, opt)) count++;
      });
    });
    return count;
  }, [groups, value]);

  // Tutup panel rekomendasi saat pengguna klik di luar area input + tray
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isOpen]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setIsOpen(true);
    if (onFocusScroll) {
      const target = e.target;
      setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape" || (!multiline && e.key === "Enter")) {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const isLg = size === "lg";

  return (
    <div ref={wrapperRef} className="w-full space-y-1.5">
      <div className="relative flex items-center">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={2}
            className="w-full p-2.5 pr-20 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-[var(--tenant-primary)] text-sm transition-colors"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`w-full pr-20 bg-gray-50 border rounded-xl outline-none focus:bg-white transition-colors placeholder-gray-400 ${
              isLg
                ? "text-sm px-3 py-2 border-gray-200 focus:border-[var(--tenant-primary)]"
                : "text-xs px-2.5 py-1.5 border-gray-200 focus:border-indigo-500 font-medium"
            }`}
          />
        )}

        {/* Badge Pemicu Interaktif di Kanan Input */}
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`absolute right-1.5 ${
              multiline ? "top-2" : "top-1/2 -translate-y-1/2"
            } px-2 py-0.5 rounded-lg text-[10px] font-extrabold flex items-center gap-1 transition-all cursor-pointer select-none ${
              isOpen
                ? "bg-indigo-600 text-white shadow-2xs"
                : activeChipCount > 0
                ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                : "bg-white/90 text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-800"
            }`}
          >
            <span></span>
            <span>{isOpen ? "Tutup" : activeChipCount > 0 ? `${activeChipCount} Opsi` : "Opsi"}</span>
          </button>
        )}
      </div>

      {/* Tray Rekomendasi — HANYA MUNCUL SAAT INPUT DIKLIK / AKTIF */}
      <AnimatePresence initial={false}>
        {isOpen && groups.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <QuickNoteChips
              product={product}
              categoryName={categoryName}
              value={value}
              onChange={onChange}
              includePackaging={includePackaging}
              size={size}
              onClose={() => {
                setIsOpen(false);
                inputRef.current?.blur();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
