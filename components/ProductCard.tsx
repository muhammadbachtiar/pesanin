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
  const isKiosk = role === "kiosk";

  const handleCardClick = (e?: React.MouseEvent) => {
    if (isCashier) {
      onAddToCart(product);
    } else if (isKiosk && onOpenDetail) {
      if (e) e.stopPropagation();
      onOpenDetail(product);
    }
  };

  const handleDecrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpdateQuantity) {
      onUpdateQuantity(product, Math.max(0, quantity - 1));
    }
  };

  const handleIncrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpdateQuantity) {
      onUpdateQuantity(product, quantity + 1);
    } else {
      onAddToCart(product);
    }
  };

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={handleCardClick}
      className={`relative text-left rounded-2xl border bg-white transition-all flex flex-col justify-between cursor-pointer select-none group border-gray-200/90 shadow-2xs hover:shadow-md min-h-[195px] sm:min-h-[215px] ${quantity > 0 ? "ring-2" : ""
        }`}
      style={{
        borderColor: quantity > 0 ? primaryColor : "#e2e8f0",
        boxShadow: quantity > 0 ? `0 0 0 2px ${primaryColor}25` : undefined,
      }}
    >
      {/* Quantity Badge (Top Right) */}
      {quantity > 0 && (
        <span
          className="absolute top-2 right-2 z-10 min-w-[22px] h-[22px] px-1.5 rounded-full text-white text-[11px] font-extrabold flex items-center justify-center shadow-md border border-white/30"
          style={{ background: secondaryColor }}
        >
          {quantity}×
        </span>
      )}

      {/* Product Image Container (Proportional height so title & price never overflow) */}
      <div
        className="w-full h-20 sm:h-24 flex-shrink-0 flex items-center justify-center bg-gray-50/70 relative p-2 cursor-pointer rounded-t-2xl overflow-hidden"
        onClick={(e) => {
          if (isKiosk && onOpenDetail) {
            e.stopPropagation();
            onOpenDetail(product);
          }
        }}
      >
        {product.image_urls[0] ? (
          <img
            src={product.image_urls[0]}
            alt={product.name}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform"
          />
        ) : (
          <span className="text-3xl">🍽️</span>
        )}
      </div>

      {/* Product Info & Footer Container */}
      <div className="p-2.5 sm:p-3 flex flex-col rounded-xl justify-between flex-1 bg-white space-y-2 min-h-[110px]">
        <div>
          {/* Product Name (Clicking Title on Kiosk opens detail modal) */}
          <p
            className="font-bold text-xs sm:text-sm leading-tight text-gray-900 line-clamp-2 cursor-pointer"
            onClick={(e) => {
              if (isKiosk && onOpenDetail) {
                e.stopPropagation();
                onOpenDetail(product);
              }
            }}
            title={product.name}
          >
            {product.name}
          </p>

          {/* Product Description (Displayed for Kiosk ONLY) */}
          {isKiosk && product.description && (
            <p
              className="text-[10px] sm:text-xs text-gray-400 mt-1 line-clamp-2 leading-snug cursor-pointer"
              onClick={(e) => {
                if (isKiosk && onOpenDetail) {
                  e.stopPropagation();
                  onOpenDetail(product);
                }
              }}
            >
              {product.description}
            </p>
          )}
        </div>

        {/* Footer Area: Price & Action Controls (Full Unclipped Visibility) */}
        <div className="flex items-center justify-between gap-1 pt-2 border-t border-gray-100 mt-auto bg-white flex-shrink-0">
          <p
            className="text-xs sm:text-sm font-black whitespace-nowrap leading-none flex-shrink-0"
            style={{ color: primaryColor }}
          >
            Rp {Number(product.base_price).toLocaleString("id-ID")}
          </p>

          {/* Action Control: Stepper vs Single Add Button */}
          {quantity > 0 && onUpdateQuantity ? (
            <div
              className="flex items-center gap-0.5 sm:gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleDecrease}
                className="w-5.5 h-5.5 sm:w-6.5 sm:h-6.5 rounded-lg bg-white hover:bg-rose-50 hover:text-rose-600 font-extrabold text-xs text-gray-700 flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
                title="Kurangi"
              >
                -
              </button>
              <span className="text-xs font-black px-1 min-w-[14px] text-center text-gray-900 leading-none">
                {quantity}
              </span>
              <button
                type="button"
                onClick={handleIncrease}
                className="w-5.5 h-5.5 sm:w-6.5 sm:h-6.5 rounded-lg text-white font-extrabold text-xs flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
                style={{ background: primaryColor }}
                title="Tambah"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToCart(product);
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl text-white font-extrabold text-xs sm:text-sm flex items-center justify-center shadow-2xs active:scale-90 transition-transform flex-shrink-0 cursor-pointer"
              style={{ background: primaryColor }}
              title="Tambah ke Keranjang"
            >
              +
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
