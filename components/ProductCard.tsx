"use client";

import React from "react";
import { motion } from "framer-motion";
import type { Product } from "@/types";

export interface ProductCardProps {
  product: Product;
  role: "cashier" | "kiosk";
  quantity: number;
  primaryColor?: string;
  secondaryColor?: string;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity?: (product: Product, newQty: number) => void;
  onOpenDetail?: (product: Product) => void;
}

/** Label key → display config */
const LABEL_CONFIG: Record<string, { emoji: string; text: string; bg: string; color: string }> = {
  spicy:         { emoji: "🌶️", text: "Pedas",      bg: "#fee2e2", color: "#b91c1c" },
  vegetarian:    { emoji: "🥦", text: "Vegetarian", bg: "#dcfce7", color: "#15803d" },
  vegan:         { emoji: "🌱", text: "Vegan",       bg: "#d1fae5", color: "#065f46" },
  best_seller:   { emoji: "🔥", text: "Terlaris",   bg: "#fef3c7", color: "#b45309" },
  new:           { emoji: "✨", text: "Baru",         bg: "#ede9fe", color: "#6d28d9" },
  halal:         { emoji: "☪️", text: "Halal",        bg: "#d1fae5", color: "#047857" },
  contains_nuts: { emoji: "🥜", text: "Kacang",     bg: "#fef3c7", color: "#92400e" },
  gluten_free:   { emoji: "🌾", text: "Non-Gluten", bg: "#e0f2fe", color: "#0369a1" },
};

function getLabelCfg(label: string) {
  return LABEL_CONFIG[label] ?? {
    emoji: "",
    text: label.replace(/_/g, " "),
    bg: "#f1f5f9",
    color: "#475569",
  };
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  role,
  quantity,
  primaryColor = "#6366f1",
  secondaryColor = "var(--tenant-secondary, #ec4899)",
  onAddToCart,
  onUpdateQuantity,
  onOpenDetail,
}) => {
  const isCashier = role === "cashier";
  const isKiosk   = role === "kiosk";

  const handleDecrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpdateQuantity) onUpdateQuantity(product, Math.max(0, quantity - 1));
  };

  const handleIncrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpdateQuantity) onUpdateQuantity(product, quantity + 1);
    else onAddToCart(product);
  };

  const rawLabels = [
    ...(product.is_featured ? ["best_seller"] : []),
    ...product.labels,
  ].slice(0, 3);

  const imgH = isCashier ? 96 : 130;

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      // ── Root card: NO onClick — each zone handles its own click ──
      className="relative text-left rounded-2xl border bg-white transition-all flex flex-col select-none group overflow-hidden"
      style={{
        borderColor: quantity > 0 ? primaryColor : "#e2e8f0",
        boxShadow: quantity > 0
          ? `0 0 0 2.5px ${primaryColor}40, 0 2px 10px rgba(0,0,0,0.08)`
          : "0 1px 4px rgba(0,0,0,0.07)",
        minHeight: isCashier ? 188 : 220,
      }}
    >
      {/* ═══════════ IMAGE ZONE ═══════════
          Cashier → tap adds to cart
          Kiosk   → tap opens detail modal
      ══════════════════════════════════ */}
      <div
        className="relative w-full flex-shrink-0 overflow-hidden bg-gray-100 cursor-pointer"
        style={{ height: imgH }}
        onClick={() => {
          if (isCashier) onAddToCart(product);
          else if (isKiosk && onOpenDetail) onOpenDetail(product);
        }}
      >
        {product.image_urls[0] ? (
          <img
            src={product.image_urls[0]}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl bg-gray-50/80">
            🍽️
          </div>
        )}

        {/* Qty badge – top right over image */}
        {quantity > 0 && (
          <span
            className="absolute top-2 right-2 min-w-[26px] h-[26px] px-1.5 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center shadow-lg border-2 border-white z-10"
            style={{ background: secondaryColor }}
          >
            {quantity}×
          </span>
        )}

        {/* Kiosk: label overlay strip at bottom of image */}
        {isKiosk && rawLabels.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 px-2 py-1.5 flex flex-wrap gap-1"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)" }}
          >
            {rawLabels.map((label) => {
              const cfg = getLabelCfg(label);
              return (
                <span
                  key={label}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap"
                  style={{ background: cfg.bg, color: cfg.color }}
                >
                  {cfg.emoji} {cfg.text}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════ INFO ZONE ═══════════
          Cashier → tap adds to cart
          Kiosk   → tap adds to cart (NOT opens modal)
      ══════════════════════════════════ */}
      <div
        className="flex flex-col flex-1 bg-white cursor-pointer"
        style={{ padding: "10px 10px 8px" }}
        onClick={() => onAddToCart(product)}
      >
        {/* Product name */}
        <p
          className="font-bold leading-tight text-gray-900 line-clamp-2 flex-shrink-0"
          style={{ fontSize: 12 }}
          title={product.name}
        >
          {product.name}
        </p>

        {/* Cashier: label chips under name */}
        {isCashier && rawLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 flex-shrink-0">
            {rawLabels.map((label) => {
              const cfg = getLabelCfg(label);
              return (
                <span
                  key={label}
                  className="text-[8px] font-bold px-1 py-0.5 rounded-full leading-none whitespace-nowrap"
                  style={{ background: cfg.bg, color: cfg.color }}
                >
                  {cfg.emoji} {cfg.text}
                </span>
              );
            })}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* ═══════════ FOOTER: Price + Action ═══════════ */}
        <div
          className="flex items-center justify-between gap-1.5 border-t border-gray-100 flex-shrink-0"
          style={{ paddingTop: 8, marginTop: 6 }}
          // Prevent info-zone click from bubbling when interacting with buttons
          onClick={(e) => e.stopPropagation()}
        >
          {/* Price — clicking it still adds to cart */}
          <p
            className="font-black whitespace-nowrap leading-none flex-shrink-0 truncate cursor-pointer"
            style={{ color: primaryColor, fontSize: 11 }}
            onClick={() => onAddToCart(product)}
          >
            Rp {Number(product.base_price).toLocaleString("id-ID")}
          </p>

          {/* ── CASHIER footer action ──
              • qty = 0 : no button (tap card/price to add)
              • qty > 0 : show "−" only to decrease quantity
          ─────────────────────────────── */}
          {isCashier && quantity > 0 && (
            <button
              type="button"
              onClick={handleDecrease}
              className="flex-shrink-0 w-7 h-7 rounded-xl font-extrabold flex items-center justify-center shadow-sm active:scale-90 transition-all cursor-pointer"
              style={{ background: "#fee2e2", color: "#b91c1c", fontSize: 16 }}
              title="Kurangi dari keranjang"
            >
              −
            </button>
          )}

          {/* ── KIOSK footer action ──
              • qty = 0 : "+" button
              • qty > 0 : full stepper "− n +"
          ─────────────────────────────── */}
          {isKiosk && (
            quantity > 0 && onUpdateQuantity ? (
              <div
                className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-xl border border-gray-200 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleDecrease}
                  className="w-6 h-6 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-600 font-extrabold text-gray-700 flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                  style={{ fontSize: 14 }}
                  title="Kurangi"
                >
                  −
                </button>
                <span
                  className="font-black px-1 min-w-[16px] text-center text-gray-900 leading-none"
                  style={{ fontSize: 11 }}
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={handleIncrease}
                  className="w-6 h-6 rounded-lg text-white font-extrabold flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                  style={{ background: primaryColor, fontSize: 14 }}
                  title="Tambah"
                >
                  +
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
                className="w-7 h-7 rounded-xl text-white font-extrabold flex items-center justify-center shadow-sm active:scale-90 transition-transform flex-shrink-0 cursor-pointer"
                style={{ background: primaryColor, fontSize: 16 }}
                title="Tambah ke Keranjang"
              >
                +
              </button>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
};
