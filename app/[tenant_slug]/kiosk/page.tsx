"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getTenantBySlug } from "@/services/tenantService";
import { getCategoriesWithProducts, getProductsByTenant } from "@/services/productService";
import { createOrder, generateQueueNumber } from "@/services/orderService";
import { validateTableToken } from "@/services/tableService";
import type { Tenant, Category, Product, CartItem, OrderType, TableRecord } from "@/types";

type KioskScreen =
  | "splash"
  | "order_type"
  | "menu"
  | "cart"
  | "table_input"
  | "summary"
  | "payment"
  | "success";

export default function KioskPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_slug: string }>;
  searchParams: Promise<{ table?: string; token?: string }>;
}) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [screen, setScreen] = useState<KioskScreen>("splash");
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [tableRecord, setTableRecord] = useState<TableRecord | null>(null);
  const [tableInputValue, setTableInputValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [queueNumber, setQueueNumber] = useState<string>("");
  const slugRef = useRef<string>("");

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const { table, token } = await searchParams;
      slugRef.current = tenant_slug;

      const t = await getTenantBySlug(tenant_slug);
      if (!t) return;
      setTenant(t);

      const [cats, prods] = await Promise.all([
        getCategoriesWithProducts(t.id),
        getProductsByTenant(t.id),
      ]);
      setCategories(cats);
      setProducts(prods);
      if (cats.length) setSelectedCategory(cats[0].id);

      if (table && token) {
        const rec = await validateTableToken(t.id, table, token);
        if (rec) setTableRecord(rec);
      }

      const saved = sessionStorage.getItem(`cart:${tenant_slug}`);
      if (saved) setCart(JSON.parse(saved));

      setTimeout(() => setScreen("order_type"), 2200);
    }
    init();
  }, [params, searchParams]);

  const saveCart = (items: CartItem[]) => {
    setCart(items);
    sessionStorage.setItem(`cart:${slugRef.current}`, JSON.stringify(items));
  };

  const addToCart = (product: Product) => {
    const unit_price = product.base_price;
    const existing = cart.find(
      (c) => c.product.id === product.id && c.selected_variants.length === 0
    );
    const updated = existing
      ? cart.map((c) =>
          c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        )
      : [...cart, { product, quantity: 1, selected_variants: [], notes: "", unit_price }];
    saveCart(updated);
  };

  const removeFromCart = (index: number) => {
    saveCart(cart.filter((_, i) => i !== index));
  };

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
  const subtotal = cart.reduce((s, c) => s + c.unit_price * c.quantity, 0);

  const handleCheckout = async () => {
    if (!tenant) return;
    const fc = tenant.finance_config;
    const tax = Math.round(subtotal * fc.tax_percentage / 100);
    const svc = Math.round(subtotal * fc.service_charge_percentage / 100);
    const tkwy = orderType === "takeaway" ? fc.takeaway_fee : 0;
    const total = subtotal + tax + svc + tkwy;
    const qn = await generateQueueNumber(tenant.id);
    setQueueNumber(qn);

    const order = await createOrder(
      {
        tenant_id: tenant.id,
        queue_number: qn,
        table_number: tableRecord?.table_number ?? tableInputValue,
        table_id: tableRecord?.id,
        order_type: orderType,
        subtotal,
        tax_amount: tax,
        service_charge_amount: svc,
        takeaway_fee_amount: tkwy,
        total_amount: total,
        finance_snapshot: {
          tax_percentage: fc.tax_percentage,
          service_charge_percentage: fc.service_charge_percentage,
          takeaway_fee: fc.takeaway_fee,
        },
      },
      cart.map((c) => ({
        product_id: c.product.id,
        product_name_snapshot: c.product.name,
        base_price_snapshot: c.product.base_price,
        selected_variants: c.selected_variants,
        quantity: c.quantity,
        unit_price: c.unit_price,
        subtotal: c.unit_price * c.quantity,
        notes: c.notes || undefined,
      }))
    );

    if (order) {
      setCreatedOrderId(order.id);
      sessionStorage.removeItem(`cart:${slugRef.current}`);
      saveCart([]);
      if (tenant.business_logic.payment_mode === "gateway") {
        setScreen("payment");
      } else {
        setScreen("payment");
      }
    }
  };

  const filteredProducts = products.filter((p) =>
    selectedCategory ? p.category_id === selectedCategory : true
  );

  // Auto redirect setelah sukses
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (
      screen === "success" ||
      (screen === "payment" && tenant?.business_logic.payment_timing === "postpaid")
    ) {
      timeout = setTimeout(() => {
        setScreen("order_type");
        setCart([]);
      }, 30000);
    }
    return () => clearTimeout(timeout);
  }, [screen, tenant?.business_logic.payment_timing]);

  if (!tenant) return null;

  const bl = tenant.business_logic;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-surface-2)" }}>
      <AnimatePresence mode="wait">

        {/* SPLASH */}
        {screen === "splash" && (
          <motion.div
            key="splash"
            className="fixed inset-0 flex flex-col items-center justify-center"
            style={{ background: "var(--tenant-primary)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4 }}
          >
            {tenant.logo_url && (
              <motion.img
                src={tenant.logo_url}
                alt={tenant.name}
                className="w-24 h-24 rounded-2xl mb-6 shadow-lg"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
              />
            )}
            <motion.h1
              className="text-4xl font-bold text-white text-center"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.35 }}
            >
              {tenant.name}
            </motion.h1>
            {tenant.subtitle && (
              <motion.p
                className="text-white/70 mt-2 text-lg"
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {tenant.subtitle}
              </motion.p>
            )}
            <motion.div
              className="mt-10 w-8 h-8 border-4 border-white/30 border-t-white rounded-full"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
            />
          </motion.div>
        )}

        {/* ORDER TYPE */}
        {screen === "order_type" && (
          <motion.div
            key="order_type"
            className="fixed inset-0 flex flex-col items-center justify-center gap-6 p-8"
            style={{ background: "var(--color-surface-2)" }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <h2 className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
              Selamat Datang 👋
            </h2>
            <p className="text-gray-500 text-lg">Pilih tipe pesanan Anda</p>
            <div className="flex gap-6 mt-4">
              {(["dine_in", "takeaway"] as OrderType[]).map((type) => (
                <motion.button
                  key={type}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setOrderType(type);
                    setScreen("menu");
                  }}
                  className="w-44 h-44 rounded-2xl flex flex-col items-center justify-center gap-3 text-white font-semibold text-xl shadow-lg"
                  style={{ background: "var(--tenant-primary)" }}
                >
                  <span className="text-5xl">{type === "dine_in" ? "🍽️" : "🛍️"}</span>
                  {type === "dine_in" ? "Makan di Sini" : "Bawa Pulang"}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* MENU */}
        {screen === "menu" && (
          <motion.div
            key="menu"
            className="min-h-screen flex flex-col"
            style={{ background: "#f8fafc" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Header */}
            <header
              className="sticky top-0 z-20 px-4 py-3 flex items-center justify-between"
              style={{ background: "var(--tenant-primary)", boxShadow: "0 2px 12px rgba(0,0,0,.15)" }}
            >
              <div className="flex items-center gap-3">
                {tenant.logo_url && (
                  <img src={tenant.logo_url} alt={tenant.name} className="w-9 h-9 rounded-xl object-cover" />
                )}
                <div>
                  <h1 className="text-white font-bold text-base leading-none">{tenant.name}</h1>
                  <p className="text-white/70 text-xs mt-0.5">
                    {orderType === "dine_in" ? "🍽️ Makan di Sini" : "🛍️ Bawa Pulang"}
                    {tableRecord && ` · Meja ${tableRecord.display_name ?? tableRecord.table_number}`}
                  </p>
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.93 }}
                onClick={() => setScreen("cart")}
                className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm"
                style={{
                  background: totalItems > 0 ? "#fff" : "rgba(255,255,255,0.2)",
                  color: totalItems > 0 ? "var(--tenant-primary)" : "#fff",
                }}
              >
                🛒 {totalItems > 0
                  ? <span>{totalItems} · Rp {subtotal.toLocaleString("id-ID")}</span>
                  : <span>Keranjang</span>}
              </motion.button>
            </header>

            {/* Category tabs */}
            <div
              className="sticky top-[60px] z-10 flex gap-2 px-3 py-2.5 overflow-x-auto border-b"
              style={{ background: "#fff" }}
            >
              <button
                onClick={() => setSelectedCategory(null)}
                className="whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all"
                style={!selectedCategory ? { background: "var(--tenant-primary)", color: "#fff" } : { background: "#f1f5f9", color: "#64748b" }}
              >
                Semua
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className="whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-all"
                  style={selectedCategory === cat.id ? { background: "var(--tenant-primary)", color: "#fff" } : { background: "#f1f5f9", color: "#64748b" }}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Featured strip */}
            {!selectedCategory && products.some((p) => p.is_featured) && (
              <div className="px-3 pt-3 pb-1">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">⭐ Menu Unggulan</p>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {products.filter((p) => p.is_featured).map((product) => (
                    <motion.button
                      key={`feat-${product.id}`}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => addToCart(product)}
                      className="flex-shrink-0 w-36 rounded-xl overflow-hidden text-left"
                      style={{ background: "#fff", border: "1.5px solid #e2e8f0" }}
                    >
                      {product.image_urls[0] ? (
                        <img src={product.image_urls[0]} alt={product.name} className="w-full h-20 object-cover" />
                      ) : (
                        <div className="w-full h-20 flex items-center justify-center text-2xl" style={{ background: "var(--tenant-primary)18" }}>🍽️</div>
                      )}
                      <div className="p-2">
                        <p className="font-semibold text-xs line-clamp-1">{product.name}</p>
                        <p className="text-xs font-bold mt-0.5" style={{ color: "var(--tenant-primary)" }}>
                          Rp {Number(product.base_price).toLocaleString("id-ID")}
                        </p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* Product grid 3 kolom */}
            <div className="flex-1 px-3 py-3 grid grid-cols-3 gap-2 pb-28 content-start">
              {filteredProducts.length === 0 && (
                <div className="col-span-3 flex flex-col items-center justify-center py-16 text-gray-400">
                  <span className="text-4xl mb-2">🍽️</span>
                  <p className="text-sm">Belum ada menu di kategori ini</p>
                </div>
              )}
              {filteredProducts.map((product) => {
                const inCart = cart.filter((c) => c.product.id === product.id).reduce((s, c) => s + c.quantity, 0);
                return (
                  <motion.div
                    key={product.id}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => addToCart(product)}
                    className="relative cursor-pointer rounded-xl overflow-hidden flex flex-col"
                    style={{
                      background: "#fff",
                      border: inCart > 0 ? "2px solid var(--tenant-primary)" : "1.5px solid #e2e8f0",
                      boxShadow: inCart > 0 ? "0 0 0 3px rgba(99,102,241,.1)" : "0 1px 3px rgba(0,0,0,.05)",
                    }}
                  >
                    {inCart > 0 && (
                      <span
                        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center"
                        style={{ background: "var(--tenant-primary)" }}
                      >
                        {inCart}
                      </span>
                    )}
                    {product.image_urls[0] ? (
                      <img src={product.image_urls[0]} alt={product.name} className="w-full object-cover" style={{ height: 72 }} />
                    ) : (
                      <div className="w-full flex items-center justify-center text-2xl" style={{ height: 72, background: "var(--tenant-primary)12" }}>🍽️</div>
                    )}
                    <div className="p-2 flex flex-col flex-1">
                      {(product.is_featured || product.labels.length > 0) && (
                        <div className="flex flex-wrap gap-0.5 mb-1">
                          {product.is_featured && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--tenant-primary)" }}>⭐</span>
                          )}
                          {product.labels.slice(0, 1).map((l) => (
                            <span key={l} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">
                              {l.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="font-semibold text-xs leading-tight line-clamp-2">{product.name}</p>
                      {product.description && (
                        <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{product.description}</p>
                      )}
                      <div className="mt-auto pt-1.5 flex items-center justify-between gap-1">
                        <p className="text-[11px] font-bold leading-none" style={{ color: "var(--tenant-primary)" }}>
                          Rp {Number(product.base_price).toLocaleString("id-ID")}
                        </p>
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: "var(--tenant-primary)" }}
                        >+</div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Sticky cart bar */}
            {totalItems > 0 && (
              <motion.div
                className="fixed bottom-0 left-0 right-0 z-30 p-3"
                initial={{ y: 80 }}
                animate={{ y: 0 }}
                transition={{ type: "spring", damping: 20 }}
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setScreen("cart")}
                  className="w-full py-3.5 rounded-2xl text-white font-bold flex items-center justify-between px-5 shadow-xl"
                  style={{ background: "var(--tenant-primary)", boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}
                >
                  <span className="bg-white/25 px-2.5 py-0.5 rounded-full text-sm font-bold">{totalItems}</span>
                  <span>Lihat Keranjang →</span>
                  <span className="text-sm">Rp {subtotal.toLocaleString("id-ID")}</span>
                </motion.button>
              </motion.div>
            )}
          </motion.div>
        )}


        {/* CART */}
        {screen === "cart" && (
          <motion.div
            key="cart"
            className="min-h-screen flex flex-col"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 24, stiffness: 200 }}
          >
            <header
              className="px-6 py-4 flex items-center gap-3 shadow-sm"
              style={{ background: "var(--tenant-primary)" }}
            >
              <button onClick={() => setScreen("menu")} className="text-white text-2xl">←</button>
              <h2 className="text-white font-bold text-xl">Keranjang</h2>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.map((item, i) => (
                <div key={i} className="card p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">{item.product.name}</p>
                    <p className="text-sm text-gray-500">
                      Rp {item.unit_price.toLocaleString("id-ID")} × {item.quantity}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-gray-400 mt-0.5">📝 {item.notes}</p>
                    )}
                  </div>
                  <p className="font-bold" style={{ color: "var(--tenant-primary)" }}>
                    Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                  </p>
                  <button
                    onClick={() => removeFromCart(i)}
                    className="text-red-400 text-xl p-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="p-4 border-t bg-white space-y-3">
              <div className="flex justify-between font-bold text-lg">
                <span>Subtotal</span>
                <span>Rp {subtotal.toLocaleString("id-ID")}</span>
              </div>
              <button
                className="btn-primary w-full py-4 text-lg rounded-xl"
                onClick={() => {
                  if (bl.numbering === "table" && !tableRecord) {
                    setScreen("table_input");
                  } else {
                    setScreen("summary");
                  }
                }}
              >
                Lanjut
              </button>
            </div>
          </motion.div>
        )}

        {/* TABLE INPUT */}
        {screen === "table_input" && (
          <motion.div
            key="table_input"
            className="fixed inset-0 flex flex-col items-center justify-center p-8 gap-6"
            style={{ background: "var(--color-surface-2)" }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            <h2 className="text-2xl font-bold">Nomor Meja Anda?</h2>
            <p className="text-gray-500">Lihat nomor meja yang tertera di meja Anda</p>
            <input
              type="text"
              value={tableInputValue}
              onChange={(e) => setTableInputValue(e.target.value)}
              placeholder="Contoh: 05"
              className="w-40 text-center text-4xl font-bold border-b-4 bg-transparent outline-none py-2"
              style={{ borderColor: "var(--tenant-primary)" }}
            />
            <button
              className="btn-primary px-12 py-4 text-xl rounded-2xl"
              onClick={() => setScreen("summary")}
              disabled={!tableInputValue}
            >
              Konfirmasi
            </button>
          </motion.div>
        )}

        {/* SUMMARY / KONFIRMASI */}
        {screen === "summary" && (
          <motion.div
            key="summary"
            className="min-h-screen flex flex-col"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <header
              className="px-6 py-4 shadow-sm flex items-center gap-3"
              style={{ background: "var(--tenant-primary)" }}
            >
              <button onClick={() => setScreen("cart")} className="text-white text-2xl">←</button>
              <h2 className="text-white font-bold text-xl">Ringkasan Pesanan</h2>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="card p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tipe</span>
                  <span className="font-medium capitalize">
                    {orderType === "dine_in" ? "Makan di sini" : "Bawa pulang"}
                  </span>
                </div>
                {(tableRecord || tableInputValue) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Meja</span>
                    <span className="font-medium">
                      {tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue}
                    </span>
                  </div>
                )}
              </div>
              <div className="card divide-y">
                {cart.map((item, i) => (
                  <div key={i} className="px-4 py-3 flex justify-between">
                    <div>
                      <p className="font-medium">{item.product.name}</p>
                      <p className="text-xs text-gray-500">×{item.quantity}</p>
                      {item.notes && <p className="text-xs text-gray-400">📝 {item.notes}</p>}
                    </div>
                    <p className="font-semibold">
                      Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                    </p>
                  </div>
                ))}
              </div>
              <div className="card p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span>Rp {subtotal.toLocaleString("id-ID")}</span>
                </div>
                {tenant.finance_config.tax_percentage > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">PPN {tenant.finance_config.tax_percentage}%</span>
                    <span>Rp {Math.round(subtotal * tenant.finance_config.tax_percentage / 100).toLocaleString("id-ID")}</span>
                  </div>
                )}
                {tenant.finance_config.service_charge_percentage > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Service {tenant.finance_config.service_charge_percentage}%</span>
                    <span>Rp {Math.round(subtotal * tenant.finance_config.service_charge_percentage / 100).toLocaleString("id-ID")}</span>
                  </div>
                )}
                {orderType === "takeaway" && tenant.finance_config.takeaway_fee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Biaya Takeaway</span>
                    <span>Rp {tenant.finance_config.takeaway_fee.toLocaleString("id-ID")}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base pt-2 border-t">
                  <span>Total</span>
                  <span style={{ color: "var(--tenant-primary)" }}>
                    Rp {(subtotal + Math.round(subtotal * tenant.finance_config.tax_percentage / 100) + Math.round(subtotal * tenant.finance_config.service_charge_percentage / 100) + (orderType === "takeaway" ? tenant.finance_config.takeaway_fee : 0)).toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-white border-t flex gap-3">
              <button
                onClick={() => setScreen("cart")}
                className="flex-1 border-2 py-4 rounded-xl font-semibold"
                style={{ borderColor: "var(--tenant-primary)", color: "var(--tenant-primary)" }}
              >
                Edit Pesanan
              </button>
              <button
                className="btn-primary flex-1 py-4 text-lg rounded-xl"
                onClick={handleCheckout}
              >
                {bl.payment_timing === "postpaid" ? "Pesan Sekarang" : "Lanjut Bayar"}
              </button>
            </div>
          </motion.div>
        )}

        {/* PAYMENT */}
        {screen === "payment" && (
          <motion.div
            key="payment"
            className="fixed inset-0 flex flex-col items-center justify-center p-8 gap-6"
            style={{ background: "var(--color-surface-2)" }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            {bl.payment_timing === "postpaid" ? (
              <>
                <div className="text-6xl">✅</div>
                <h2 className="text-2xl font-bold text-center">Pesanan Diterima!</h2>
                <p className="text-gray-500 text-center">
                  Pesanan Anda sedang diproses. Kasir akan segera mengkonfirmasi.
                </p>
                <div className="card p-6 text-center">
                  <p className="text-gray-500 text-sm">Nomor Antrian</p>
                  <p className="text-5xl font-black mt-1" style={{ color: "var(--tenant-primary)" }}>
                    #{queueNumber}
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setScreen("order_type");
                    setCart([]);
                  }}
                  className="mt-4 px-8 py-3 rounded-xl font-medium"
                  style={{ background: "var(--tenant-primary)", color: "white" }}
                >
                  Kembali ke Menu Utama
                </motion.button>
              </>
            ) : bl.payment_mode === "manual" ? (
              <>
                <h2 className="text-2xl font-bold">Pilih Pembayaran</h2>
                <div className="w-full max-w-sm space-y-3">
                  {tenant.manual_payment_channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => setScreen("success")}
                      className="card w-full p-4 flex items-center gap-4 text-left"
                    >
                      <span className="text-3xl">
                        {ch.type === "qris_static" ? "📱" : ch.type === "bank_transfer" ? "🏦" : "💵"}
                      </span>
                      <div>
                        <p className="font-semibold">{ch.label}</p>
                        {ch.instructions && (
                          <p className="text-xs text-gray-500 mt-0.5">{ch.instructions}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-gray-500">Gateway payment integration pending.</p>
            )}
          </motion.div>
        )}

        {/* SUCCESS */}
        {screen === "success" && (
          <motion.div
            key="success"
            className="fixed inset-0 flex flex-col items-center justify-center gap-6 p-8"
            style={{ background: "var(--tenant-primary)" }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <motion.div
              className="text-7xl"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
            >
              🎉
            </motion.div>
            <h2 className="text-3xl font-bold text-white text-center">Terima Kasih!</h2>
            <div className="bg-white rounded-2xl p-6 text-center w-full max-w-xs">
              <p className="text-gray-500 text-sm">Nomor Antrian Anda</p>
              <p className="text-6xl font-black mt-1" style={{ color: "var(--tenant-primary)" }}>
                #{queueNumber}
              </p>
              {(tableRecord || tableInputValue) && (
                <>
                  <p className="text-gray-400 text-xs mt-3">Meja</p>
                  <p className="font-bold text-lg">
                    {tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue}
                  </p>
                </>
              )}
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setScreen("order_type");
                setCart([]);
              }}
              className="bg-white/20 text-white px-8 py-3 rounded-xl font-medium"
            >
              Kembali ke Menu Utama
            </motion.button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
