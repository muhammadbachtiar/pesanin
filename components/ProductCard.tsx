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
  /** Jika true, tampilkan badge "Sisa N" di card (khusus Kasir). Kiosk tidak perlu tahu angka stok. */
  showStockBadge?: boolean;
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
  showStockBadge = false,
  onAddToCart,
  onUpdateQuantity,
  onOpenDetail,
}) => {
  const isCashier = role === "cashier";
  const isKiosk   = role === "kiosk";

  // Produk dianggap habis jika is_available = false ATAU stock_count sudah 0
  const isOutOfStock =
    !product.is_available ||
    (product.stock_count !== null && product.stock_count <= 0);

  // Badge "Sisa N" hanya muncul di Kasir, ketika stok <= 5 dan belum habis
  const showLowStock =
    showStockBadge &&
    product.stock_count !== null &&
    product.stock_count > 0 &&
    product.stock_count <= 5;

  // Hitung diskon promo jika discount_price valid & lebih murah dari base_price
  const hasPromo =
    product.discount_price !== null &&
    product.discount_price !== undefined &&
    product.discount_price > 0 &&
    product.discount_price < product.base_price;

  const effectivePrice = hasPromo ? product.discount_price! : product.base_price;
  const discountPct = hasPromo
    ? Math.round(((product.base_price - product.discount_price!) / product.base_price) * 100)
    : 0;

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
      whileTap={isOutOfStock ? undefined : { scale: 0.97 }}
      // ── Root card: NO onClick — each zone handles its own click ──
      className="relative text-left rounded-2xl border bg-white transition-all flex flex-col select-none group overflow-hidden"
      style={{
        borderColor: isOutOfStock ? "#e2e8f0" : quantity > 0 ? primaryColor : hasPromo ? "#fbcfe8" : "#e2e8f0",
        boxShadow: isOutOfStock
          ? "0 1px 4px rgba(0,0,0,0.05)"
          : quantity > 0
          ? `0 0 0 2.5px ${primaryColor}40, 0 2px 10px rgba(0,0,0,0.08)`
          : hasPromo
          ? "0 2px 8px rgba(244,63,94,0.08)"
          : "0 1px 4px rgba(0,0,0,0.07)",
        minHeight: isCashier ? 188 : 220,
        opacity: isOutOfStock ? 0.55 : 1,
        pointerEvents: isOutOfStock ? "none" : "auto",
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
        {quantity > 0 && !isOutOfStock && (
          <span
            className="absolute top-2 right-2 min-w-[26px] h-[26px] px-1.5 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center shadow-lg border-2 border-white z-10"
            style={{ background: secondaryColor }}
          >
            {quantity}×
          </span>
        )}

        {/* Badge Promo Diskon – top left over image (jika tidak habis) */}
        {hasPromo && !isOutOfStock && (
          <span className="absolute top-2 left-2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full z-10 shadow-md flex items-center gap-0.5 border border-white/40">
            <span>🔥</span> -{discountPct}%
          </span>
        )}

        {/* Badge HABIS — tampil di semua role ketika out of stock */}
        {isOutOfStock && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900/40 backdrop-blur-[1px]">
            <span className="bg-gray-900/90 text-white text-[10px] font-black px-3 py-1.5 rounded-full tracking-wider uppercase border border-gray-600/50 shadow-md">
              🚫 Habis
            </span>
          </div>
        )}

        {/* Badge "Sisa N" — hanya di Kasir (showStockBadge), jika bukan promo atau diletakkan di bawah badge promo */}
        {showLowStock && !isOutOfStock && (
          <span
            className={`absolute ${hasPromo ? "top-8" : "top-2"} left-2 bg-amber-500 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-full z-10 shadow`}
          >
            Sisa {product.stock_count}
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
                  className="text-[8px] font-bold px-1.5 py-0.5 rounded-full text-white leading-none backdrop-blur-xs"
                  style={{ background: "rgba(0,0,0,0.55)" }}
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
          Kiosk   → tap adds to cart (gambar yang buka modal)
      ══════════════════════════════════ */}
      <div
        className="p-2.5 sm:p-3 flex-1 flex flex-col justify-between cursor-pointer"
        onClick={() => onAddToCart(product)}
      >
        {/* Product Name */}
        <h3
          className="font-bold text-gray-900 line-clamp-2 leading-snug group-hover:text-indigo-600 transition-colors"
          style={{ fontSize: isCashier ? 11 : 12.5 }}
          title={product.name}
        >
          {product.name}
        </h3>

        {/* Description / Subtitle */}
        {product.description && (
          <p
            className="text-gray-400 line-clamp-1 mt-0.5 leading-none"
            style={{ fontSize: isCashier ? 9.5 : 10.5 }}
          >
            {product.description}
          </p>
        )}

        {/* Cashier: inline pill labels */}
        {isCashier && rawLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
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
          {/* Price with strike-through for promo */}
          <div className="flex flex-col min-w-0 cursor-pointer" onClick={() => onAddToCart(product)}>
            {hasPromo && (
              <span className="text-[9px] text-gray-400 line-through font-semibold leading-none">
                Rp {Number(product.base_price).toLocaleString("id-ID")}
              </span>
            )}
            <p
              className="font-black whitespace-nowrap leading-none flex-shrink-0 truncate"
              style={{ color: hasPromo ? "#e11d48" : primaryColor, fontSize: isCashier ? 11 : 12.5 }}
            >
              Rp {Number(effectivePrice).toLocaleString("id-ID")}
            </p>
          </div>

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
