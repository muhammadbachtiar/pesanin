"use client";

import { useMemo } from "react";
import { getQuickNoteGroups, isQuickNoteActive, toggleQuickNote } from "@/lib/quickNotes";

interface QuickNoteChipsProps {
  product: { name: string; description?: string | null; labels?: string[] | null };
  categoryName?: string | null;
  /** Teks catatan saat ini */
  value: string;
  /** Callback ketika catatan berubah akibat klik chip */
  onChange: (next: string) => void;
  /** Tampilkan grup penyajian (bungkus terpisah, sendok, dll.) untuk takeaway */
  includePackaging?: boolean;
  /** "lg" untuk layar sentuh Kiosk, "sm" untuk panel Kasir yang padat */
  size?: "sm" | "lg";
}

/**
 * Chip rekomendasi catatan sekali klik. Opsi menyesuaikan jenis menu
 * (kopi → gula/es/shot, makanan → level pedas/tanpa bawang, snack → saus, dst.).
 */
export function QuickNoteChips({
  product,
  categoryName,
  value,
  onChange,
  includePackaging = false,
  size = "lg",
}: QuickNoteChipsProps) {
  const groups = useMemo(
    () => getQuickNoteGroups(product, categoryName, includePackaging),
    [product, categoryName, includePackaging]
  );

  if (groups.length === 0) return null;

  const isLg = size === "lg";

  return (
    <div className={isLg ? "space-y-2.5" : "space-y-1.5"}>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-wrap items-center gap-1.5">
          <span
            className={`${isLg ? "text-[11px] min-w-[72px]" : "text-[10px] min-w-[58px]"} font-extrabold uppercase tracking-wide text-gray-400`}
          >
            {group.label}
            {group.exclusive ? "" : " +"}
          </span>
          {group.options.map((opt) => {
            const active = isQuickNoteActive(value, opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(toggleQuickNote(value, opt, group))}
                className={`${
                  isLg ? "px-3 py-1.5 text-xs" : "px-2 py-0.5 text-[11px]"
                } rounded-full font-bold border transition-all active:scale-95 cursor-pointer select-none ${
                  active
                    ? "text-white border-transparent shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                }`}
                style={active ? { background: "var(--tenant-primary)" } : undefined}
              >
                {active ? "✓ " : ""}
                {opt}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
