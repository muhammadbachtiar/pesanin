"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getTenantBySlug } from "@/services/tenantService";
import { getCategoriesWithProducts, getProductsByTenant } from "@/services/productService";
import { createOrder, generateQueueNumber, getActiveOrderByTable, buildCustomerNotes } from "@/services/orderService";
import { validateTableToken } from "@/services/tableService";
import { getSupabaseClient } from "@/lib/supabase";
import type { Tenant, Category, Product, CartItem, OrderType, TableRecord } from "@/types";
import { ProductCard } from "@/components/ProductCard";

type KioskScreen =
  | "splash"
  | "order_type"
  | "menu"
  | "cart"
  | "customer_info"
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
  const [customerName, setCustomerName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalNotes, setModalNotes] = useState("");
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [queueNumber, setQueueNumber] = useState<string>("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [tableInputError, setTableInputError] = useState<string | null>(null);
  const [isCheckingTable, setIsCheckingTable] = useState(false);
  const slugRef = useRef<string>("");
  // Ref untuk cleanup realtime channel produk saat unmount
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const productChannelRef = useRef<any>(null);

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

      // ── REALTIME: Subscribe products table — Kiosk auto-disables card saat stok habis ──
      // Info stok (angka) TIDAK ditampilkan di Kiosk, hanya status aktif/nonaktif.
      const supabase = getSupabaseClient();
      const productChannel = supabase
        .channel(`kiosk-products-${t.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "products", filter: `tenant_id=eq.${t.id}` },
          (payload: { new: { id: string; is_available: boolean; stock_count: number | null } }) => {
            setProducts((prev) =>
              prev.map((p) =>
                p.id === payload.new.id
                  ? { ...p, is_available: payload.new.is_available, stock_count: payload.new.stock_count }
                  : p
              )
            );
          }
        )
        .subscribe();
      productChannelRef.current = productChannel;
    }
    init();
    return () => {
      const supabase = getSupabaseClient();
      if (productChannelRef.current) supabase.removeChannel(productChannelRef.current);
    };
  }, [params, searchParams]);

  const saveCart = (items: CartItem[]) => {
    setCart(items);
    sessionStorage.setItem(`cart:${slugRef.current}`, JSON.stringify(items));
  };

  const addToCart = (product: Product, quantity = 1, notes = "") => {
    if (quantity <= 0) return;
    const unit_price = product.base_price;
    const existingIndex = cart.findIndex(
      (c) => c.product.id === product.id && c.selected_variants.length === 0 && (c.notes || "") === notes
    );
    const updated = [...cart];
    if (existingIndex >= 0) {
      updated[existingIndex].quantity += quantity;
    } else {
      updated.push({ product, quantity, selected_variants: [], notes, unit_price });
    }
    saveCart(updated);
  };

  const decreaseProductQuantity = (productId: string) => {
    let idx = cart.findIndex(c => c.product.id === productId && !c.notes);
    if (idx === -1) idx = cart.findIndex(c => c.product.id === productId);
    if (idx !== -1) {
      const updated = [...cart];
      if (updated[idx].quantity > 1) {
        updated[idx].quantity -= 1;
      } else {
        updated.splice(idx, 1);
      }
      saveCart(updated);
    }
  };

  const updateCartItemQuantity = (index: number, quantity: number) => {
    if (quantity <= 0) {
      setConfirmDeleteIndex(index);
      return;
    }
    const updated = [...cart];
    updated[index].quantity = quantity;
    saveCart(updated);
  };

  const updateCartItemNotes = (index: number, notes: string) => {
    const updated = [...cart];
    updated[index].notes = notes;
    saveCart(updated);
  };

  const removeFromCart = (index: number) => {
    setConfirmDeleteIndex(index);
  };

  const confirmRemoveAction = () => {
    if (confirmDeleteIndex !== null) {
      saveCart(cart.filter((_, i) => i !== confirmDeleteIndex));
      setConfirmDeleteIndex(null);
    }
  };

  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
  const subtotal = cart.reduce((s, c) => s + c.unit_price * c.quantity, 0);

  const handleCheckout = async () => {
    if (!tenant || isCheckingOut) return;

    const isTableMode = tenant.business_logic.numbering === "table" && orderType !== "takeaway";
    const targetTableNum = (tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue).trim();

    if (isTableMode) {
      if (!targetTableNum) {
        alert("Nomor Meja wajib diisi untuk pesanan Dine-In!");
        setScreen("table_input");
        return;
      }
      const activeExisting = await getActiveOrderByTable(tenant.id, targetTableNum);
      if (activeExisting) {
        alert(`⚠️ Meja "${targetTableNum}" sedang terisi oleh pesanan aktif yang belum selesai. Harap gunakan nomor meja lain!`);
        setScreen("table_input");
        return;
      }
    }

    setIsCheckingOut(true);
    try {
      const fc = tenant.finance_config;
      const tax = Math.round(subtotal * fc.tax_percentage / 100);
      const svc = Math.round(subtotal * fc.service_charge_percentage / 100);
      const tkwy = orderType === "takeaway" ? fc.takeaway_fee : 0;
      const total = subtotal + tax + svc + tkwy;
      const qn = await generateQueueNumber(tenant.id);
      setQueueNumber(qn);

      const notesWithCustomerName = buildCustomerNotes("", false, [], customerName.trim());
      const order = await createOrder(
        {
          tenant_id: tenant.id,
          queue_number: qn,
          customer_name: customerName.trim() || undefined,
          customer_notes: notesWithCustomerName || undefined,
          table_number: isTableMode ? targetTableNum : undefined,
          table_id: orderType !== "takeaway" ? tableRecord?.id : undefined,
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
        // Kasir yang akan mengkonfirmasi metode pembayaran pelanggan
        setScreen("success");
      }
    } finally {
      setIsCheckingOut(false);
    }
  };

  const resetSession = useCallback(() => {
    setScreen("order_type");
    setCart([]);
    setTableInputValue("");
    setCustomerName("");
    setTableRecord(null);
  }, []);

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
        resetSession();
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
                className="text-white/80 mt-3 text-lg text-center px-8 max-w-md mx-auto leading-relaxed"
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
                        <div className="w-full h-28 bg-gray-50 flex items-center justify-center p-1">
                          <img src={product.image_urls[0]} alt={product.name} className="w-full h-full object-contain rounded" />
                        </div>
                      ) : (
                        <div className="w-full h-28 flex items-center justify-center text-2xl" style={{ background: "var(--tenant-primary)18" }}>🍽️</div>
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

            {/* Product grid responsive */}
            <div className="flex-1 px-3 py-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4 pb-28 content-start">
              {filteredProducts.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-gray-400">
                  <span className="text-4xl mb-2">🍽️</span>
                  <p className="text-sm">Belum ada menu di kategori ini</p>
                </div>
              )}
              {filteredProducts.map((product) => {
                const inCart = cart.filter((c) => c.product.id === product.id).reduce((s, c) => s + c.quantity, 0);
                return (
                  <ProductCard
                    key={product.id}
                    product={product}
                    role="kiosk"
                    quantity={inCart}
                    primaryColor="var(--tenant-primary)"
                    secondaryColor="var(--tenant-secondary)"
                    onAddToCart={(p) => addToCart(p, 1, "")}
                    onUpdateQuantity={(p, newQty) => {
                      if (newQty < inCart) {
                        decreaseProductQuantity(p.id);
                      } else {
                        addToCart(p, 1, "");
                      }
                    }}
                    onOpenDetail={(p) => {
                      setActiveProduct(p);
                      setModalQuantity(1);
                      setModalNotes("");
                    }}
                  />
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
                  style={{ background: "var(--tenant-secondary, var(--tenant-primary))", boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}
                >
                  <span className="px-2.5 py-0.5 rounded-full text-sm font-bold shadow-xs" style={{ background: "rgba(0,0,0,0.15)", color: "#fff" }}>{totalItems}</span>
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
                <div key={i} className="card p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    {item.product.image_urls[0] ? (
                      <div className="w-16 h-16 rounded-xl bg-gray-50 flex-shrink-0 flex items-center justify-center p-1 border">
                        <img src={item.product.image_urls[0]} alt={item.product.name} className="w-full h-full object-contain rounded-lg" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-xl flex-shrink-0 flex items-center justify-center text-3xl border" style={{ background: "var(--tenant-primary)12" }}>🍽️</div>
                    )}
                    <div className="flex-1 flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-base leading-tight mt-0.5">{item.product.name}</p>
                        <p className="text-sm font-bold mt-1" style={{ color: "var(--tenant-primary)" }}>
                          Rp {item.unit_price.toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="font-bold text-lg flex-shrink-0">
                          Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                        </p>
                        <button
                          onClick={() => removeFromCart(i)}
                          className="text-red-400 text-xs font-bold mt-1"
                        >
                          Hapus ✕
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateCartItemQuantity(i, item.quantity - 1)} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-lg">-</button>
                      <input type="number" value={item.quantity === 0 ? "" : item.quantity} onChange={(e) => updateCartItemQuantity(i, parseInt(e.target.value) || 0)} className="w-12 text-center bg-gray-50 border rounded-lg py-1.5 text-sm font-bold" />
                      <button onClick={() => updateCartItemQuantity(i, item.quantity + 1)} className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-lg" style={{ background: "var(--tenant-secondary, var(--tenant-primary))" }}>+</button>
                    </div>
                    <input
                      value={item.notes || ""}
                      onChange={(e) => updateCartItemNotes(i, e.target.value)}
                      placeholder="Tulis Opsional (Minta Pedas, dsb...)"
                      className="flex-1 text-sm p-2 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:border-[var(--tenant-primary)] placeholder-gray-400"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t bg-white space-y-3">
              <div className="flex justify-between font-bold text-lg">
                <span>Subtotal</span>
                <span>Rp {subtotal.toLocaleString("id-ID")}</span>
              </div>
              <button
                className="btn-primary w-full py-4 text-lg font-bold rounded-xl"
                onClick={() => setScreen("customer_info")}
              >
                Lanjut ke Informasi Pemesan →
              </button>
            </div>
          </motion.div>
        )}

        {/* DEDICATED CUSTOMER & TABLE INFO SCREEN (Fun & Engaging Kiosk Style) */}
        {(screen === "customer_info" || screen === "table_input") && (
          <motion.div
            key="customer_info"
            className="fixed inset-0 flex flex-col justify-between p-6 bg-slate-50 z-40 overflow-y-auto"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            <div className="max-w-md w-full mx-auto space-y-6 my-auto pt-4 pb-6">

              {/* Fun Header */}
              <div className="text-center space-y-3">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                    Sedikit Lagi!
                  </h2>
                  <p className="text-gray-500 text-sm font-medium leading-relaxed mt-1 max-w-xs mx-auto">
                    {orderType === "takeaway"
                      ? "Siapa nama kamu? Nanti kami panggil pas pesanannya siap!"
                      : bl.numbering === "table"
                        ? "Biar pesananmu sampai tepat ke mejamu, yuk isi nomor meja & nama kamu!"
                        : "Biar kami tahu siapa kamu, sebutkan nama panggilanmu ya!"}
                  </p>
                </div>
              </div>

              {/* Input Cards Container */}
              <div className="space-y-4">

                {/* 1. Nomor Meja Field (Dine-In Table Mode) */}
                {bl.numbering === "table" && orderType !== "takeaway" && (
                  <div className="bg-white p-5 rounded-2xl border border-gray-200/90 shadow-sm space-y-2.5 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-center">
                      <label className="block text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                        <span>🪑</span>
                        <span>Nomor Meja Kamu</span>
                        <span className="text-rose-500 font-bold">*</span>
                      </label>
                      {tableRecord && (
                        <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                          ✨ QR Meja {tableRecord.table_number}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue}
                      onChange={(e) => {
                        if (!tableRecord) {
                          setTableInputValue(e.target.value);
                          setTableInputError(null);
                        }
                      }}
                      disabled={!!tableRecord}
                      placeholder="Misal: 05 atau Meja 12"
                      className="w-full text-lg font-black px-4 py-3.5 border-2 border-gray-200 rounded-xl bg-gray-50/60 outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 transition-all text-gray-900 disabled:opacity-75 disabled:bg-gray-100"
                    />
                    <p className="text-[11px] text-gray-400 font-semibold flex items-center gap-1">
                      <span>💡</span> Coba ambil nomor meja yang tersedia atau lihat angka di sudut mejamu ya!
                    </p>
                  </div>
                )}

                {/* 2. Nama Pemesan Field */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200/90 shadow-sm space-y-2.5 hover:shadow-md transition-shadow">
                  <label className="block text-xs font-black uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                    <span>🏷️</span>
                    <span>Nama Panggilan Kamu</span>
                    {bl.numbering === "table" && orderType !== "takeaway" ? (
                      <span className="text-gray-400 font-normal lowercase">(opsional)</span>
                    ) : (
                      <span className="text-rose-500 font-bold">*</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setTableInputError(null);
                    }}
                    placeholder="Misal: Budi, Kak Siti, Bro Alif..."
                    className="w-full text-lg font-black px-4 py-3.5 border-2 border-gray-200 rounded-xl bg-gray-50/60 outline-none focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 transition-all text-gray-900"
                  />
                  <p className="text-[11px] text-gray-400 font-semibold flex items-center gap-1">
                    <span>🙌</span> Biar ramah pas kami panggil atau antarkan pesananmu!
                  </p>
                </div>

                {/* Error Banner */}
                {tableInputError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl border-2 border-rose-200 bg-rose-50 text-rose-900 text-xs font-bold flex items-center gap-2.5 shadow-sm"
                  >
                    <span className="text-lg">🙈</span>
                    <span>{tableInputError}</span>
                  </motion.div>
                )}

              </div>

              {/* Fun Navigation Actions */}
              <div className="pt-2 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={isCheckingTable}
                  onClick={async () => {
                    const isTableRequired = bl.numbering === "table" && orderType !== "takeaway";
                    const targetTableNum = (tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue).trim();
                    const trimmedName = customerName.trim();

                    if (isTableRequired) {
                      if (!targetTableNum) {
                        setTableInputError("Nomor mejamu belum diisi nih! Isi dulu yuk 😉");
                        return;
                      }
                      if (tenant && !tableRecord) {
                        setIsCheckingTable(true);
                        const activeExisting = await getActiveOrderByTable(tenant.id, targetTableNum);
                        setIsCheckingTable(false);
                        if (activeExisting) {
                          setTableInputError(`Wah, Meja "${targetTableNum}" sedang terisi pesanan lain nih. Pilih nomor meja lain ya! 🪑`);
                          return;
                        }
                      }
                    } else {
                      if (!trimmedName) {
                        setTableInputError("Isi nama panggilanmu dulu ya biar gak tertukar! 😉");
                        return;
                      }
                    }

                    setTableInputError(null);
                    setScreen("summary");
                  }}
                  className="w-full py-4 text-lg font-black text-white rounded-2xl shadow-xl active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  style={{ background: "var(--tenant-primary)" }}
                >
                  {isCheckingTable ? "Memeriksa Meja... ⏳" : "Lanjut Konfirmasi Pesanan"}
                </button>

                <button
                  type="button"
                  onClick={() => setScreen("cart")}
                  className="w-full py-2.5 text-xs font-extrabold text-gray-500 hover:text-gray-900 transition-colors text-center cursor-pointer"
                >
                  ← Cek Keranjang Lagi
                </button>
              </div>

            </div>
          </motion.div>
        )}

        {/* SUMMARY / KONFIRMASI PESANAN (Matching customer_info Fun Kiosk Style) */}
        {screen === "summary" && (
          <motion.div
            key="summary"
            className="fixed inset-0 flex flex-col justify-between p-6 bg-slate-50 z-40 overflow-y-auto"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            <div className="max-w-md w-full mx-auto space-y-5 my-auto pt-4 pb-6">

              {/* Fun Header */}
              <div className="text-center space-y-3">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                    Cek Pesananmu Dulu!
                  </h2>
                  <p className="text-gray-500 text-sm font-medium leading-relaxed mt-1 max-w-xs mx-auto">
                    Pastikan semua menu pesananmu sudah sesuai!
                  </p>
                </div>
              </div>

              {/* Cards Container */}
              <div className="space-y-3.5">

                {/* 1. Customer & Order Details Card */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200/90 shadow-sm space-y-3 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-lg border border-amber-200/60">
                        👤
                      </span>
                      <div>
                        <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wider">Pemesan</p>
                        <p className="text-sm font-black text-gray-900">{customerName.trim() || "Pelanggan Kiosk"}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setScreen("customer_info")}
                      className="text-xs text-indigo-600 font-extrabold hover:underline cursor-pointer bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100"
                    >
                      Ubah ✏️
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
                    <span>Tipe Pemesanan:</span>
                    <span className="font-bold text-gray-900 bg-gray-100 px-2.5 py-1 rounded-lg">
                      {orderType === "dine_in" ? "🍽️ Makan di Sini" : "🛍️ Bawa Pulang"}
                    </span>
                  </div>

                  {(tableRecord || tableInputValue) && orderType !== "takeaway" && (
                    <div className="flex items-center justify-between text-xs font-semibold text-gray-600">
                      <span>Lokasi Meja:</span>
                      <span className="font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                        🪑 Meja {tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue}
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. Items List Card */}
                <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm divide-y divide-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-100 flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                      <span>🛒</span>
                      <span>Item Pesanan ({cart.reduce((s, c) => s + c.quantity, 0)})</span>
                    </span>
                    <button onClick={() => setScreen("cart")} className="text-xs font-extrabold text-indigo-600 hover:underline cursor-pointer">
                      Edit ✏️
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {cart.map((item, i) => (
                      <div key={i} className="px-4 py-3 flex justify-between items-center">
                        <div>
                          <p className="font-extrabold text-xs text-gray-900">{item.product.name}</p>
                          <p className="text-[11px] text-gray-500 font-semibold mt-0.5">×{item.quantity} @ Rp {item.unit_price.toLocaleString("id-ID")}</p>
                          {item.notes && <p className="text-[11px] text-amber-700 font-semibold mt-0.5">📝 {item.notes}</p>}
                        </div>
                        <p className="font-black text-xs text-gray-900">
                          Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Financial Calculation Card */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200/90 shadow-sm space-y-2 text-xs font-medium text-gray-600 hover:shadow-md transition-shadow">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-bold text-gray-900">Rp {subtotal.toLocaleString("id-ID")}</span>
                  </div>
                  {tenant.finance_config.tax_percentage > 0 && (
                    <div className="flex justify-between">
                      <span>PPN ({tenant.finance_config.tax_percentage}%)</span>
                      <span>Rp {Math.round(subtotal * tenant.finance_config.tax_percentage / 100).toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  {tenant.finance_config.service_charge_percentage > 0 && (
                    <div className="flex justify-between">
                      <span>Service ({tenant.finance_config.service_charge_percentage}%)</span>
                      <span>Rp {Math.round(subtotal * tenant.finance_config.service_charge_percentage / 100).toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  {orderType === "takeaway" && tenant.finance_config.takeaway_fee > 0 && (
                    <div className="flex justify-between">
                      <span>Biaya Takeaway</span>
                      <span>Rp {tenant.finance_config.takeaway_fee.toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-base pt-2.5 border-t border-gray-100 text-gray-900">
                    <span>Total Tagihan</span>
                    <span style={{ color: "var(--tenant-primary)" }}>
                      Rp {(subtotal + Math.round(subtotal * tenant.finance_config.tax_percentage / 100) + Math.round(subtotal * tenant.finance_config.service_charge_percentage / 100) + (orderType === "takeaway" ? tenant.finance_config.takeaway_fee : 0)).toLocaleString("id-ID")}
                    </span>
                  </div>
                </div>

              </div>

              {/* Clean Navigation Actions (NO background card wrapper!) */}
              <div className="pt-2 flex flex-col gap-3">
                <button
                  type="button"
                  className="w-full py-4 text-lg font-black text-white rounded-2xl shadow-xl active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--tenant-primary)" }}
                  onClick={handleCheckout}
                  disabled={isCheckingOut}
                >
                  {isCheckingOut ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white mr-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Memproses Pesanan... ⏳</span>
                    </>
                  ) : (
                    <>
                      <span>⚡ Konfirmasi &amp; Buat Pesanan</span>
                      <span>· Rp {(subtotal + Math.round(subtotal * tenant.finance_config.tax_percentage / 100) + Math.round(subtotal * tenant.finance_config.service_charge_percentage / 100) + (orderType === "takeaway" ? tenant.finance_config.takeaway_fee : 0)).toLocaleString("id-ID")}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setScreen("customer_info")}
                  className="w-full py-2.5 text-xs font-extrabold text-gray-500 hover:text-gray-900 transition-colors text-center cursor-pointer"
                >
                  ← Ubah Informasi Pemesan
                </button>
              </div>

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
                  <p className="text-5xl font-black mt-1" style={{ color: "var(--tenant-secondary, var(--tenant-primary))" }}>
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
            <div className="bg-white rounded-2xl p-6 text-center w-full max-w-xs shadow-xl">
              <p className="text-gray-500 text-sm">Nomor Antrian Anda</p>
              <p className="text-6xl font-black mt-1" style={{ color: "var(--tenant-primary)" }}>
                #{queueNumber}
              </p>
              {(tableRecord || tableInputValue) && orderType !== "takeaway" && (
                <>
                  <p className="text-gray-400 text-xs mt-3">Meja</p>
                  <p className="font-bold text-lg">
                    {tableRecord?.display_name ?? tableRecord?.table_number ?? tableInputValue}
                  </p>
                </>
              )}
            </div>

            <p className="text-white text-center text-sm px-4 max-w-sm opacity-90 leading-relaxed">
              {bl.payment_timing === "postpaid"
                ? "Pesanan Anda telah masuk dan sedang kami siapkan. Silakan duduk dan kami akan menghubungi Anda saat pesanan siap."
                : (orderType === "dine_in" && (tableRecord || tableInputValue)
                  ? "Silakan tunjukkan nomor antrian ini kepada kasir untuk menyelesaikan pembayaran."
                  : "Silakan tunjukkan nomor antrian ini kepada kasir untuk menyelesaikan pembayaran Anda.")}
            </p>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={resetSession}
              className="bg-white/20 text-white px-8 py-3 rounded-xl font-medium"
            >
              Kembali ke Menu Utama
            </motion.button>
          </motion.div>
        )}

        {/* PRODUCT DETAIL MODAL */}
        <AnimatePresence>
          {activeProduct && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
              <motion.div
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setActiveProduct(null)}
              />
              <motion.div
                className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col overflow-hidden z-10 shadow-2xl relative"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                style={{ maxHeight: "90vh" }}
              >
                {activeProduct.image_urls[0] ? (
                  <div className="w-full bg-gray-50 flex items-center justify-center p-2" style={{ height: 240 }}>
                    <img src={activeProduct.image_urls[0]} alt={activeProduct.name} className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-full flex items-center justify-center text-5xl" style={{ height: 200, background: "var(--tenant-primary)18" }}>🍽️</div>
                )}

                <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-3">
                  <div className="flex justify-between items-start gap-4">
                    <h2 className="text-xl font-bold leading-tight">{activeProduct.name}</h2>
                    <p className="font-bold text-lg flex-shrink-0" style={{ color: "var(--tenant-primary)" }}>
                      Rp {Number(activeProduct.base_price).toLocaleString("id-ID")}
                    </p>
                  </div>

                  {(activeProduct.is_featured || activeProduct.labels.length > 0) && (
                    <div className="flex flex-wrap gap-1">
                      {activeProduct.is_featured && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white shadow-xs" style={{ background: "var(--tenant-secondary, var(--tenant-primary))" }}>⭐ Unggulan</span>
                      )}
                      {activeProduct.labels.map((l) => (
                        <span key={l} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 capitalize">
                          {l.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2">
                    <h3 className="text-sm font-bold text-gray-800 mb-1">Deskripsi</h3>
                    <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-wrap">
                      {activeProduct.description || "Tidak ada deskripsi tersedia untuk produk ini."}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-col gap-4 border-t pt-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-2">Jumlah Pesanan</h3>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setModalQuantity(Math.max(1, modalQuantity - 1))} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-xl cursor-pointer">-</button>
                        <input type="number" value={modalQuantity || ""} onChange={(e) => setModalQuantity(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 h-10 text-center text-lg font-bold border-b-2 bg-transparent outline-none p-1" style={{ borderColor: 'var(--tenant-primary)' }} />
                        <button onClick={() => setModalQuantity(modalQuantity + 1)} className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xl cursor-pointer" style={{ background: "var(--tenant-secondary, var(--tenant-primary))" }}>+</button>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-2">Catatan Tambahan</h3>
                      <textarea
                        value={modalNotes}
                        onChange={(e) => setModalNotes(e.target.value)}
                        placeholder="Contoh: Jangan terlalu pedas, tambah es, dll."
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[var(--tenant-primary)] text-sm"
                        rows={2}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t flex gap-3 bg-white">
                  <button
                    className="px-6 py-4 rounded-xl font-bold border-2 text-gray-600 border-gray-200 cursor-pointer active:bg-gray-100 transition-colors"
                    onClick={() => setActiveProduct(null)}
                  >
                    Tutup
                  </button>
                  <button
                    className="flex-1 py-4 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-lg active:scale-95 transition-transform cursor-pointer shadow-md"
                    style={{ background: "var(--tenant-primary)" }}
                    onClick={() => {
                      addToCart(activeProduct, modalQuantity, modalNotes);
                      setActiveProduct(null);
                    }}
                  >
                    Tambah <span>Rp {(Number(activeProduct.base_price) * modalQuantity).toLocaleString("id-ID")}</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* CONFIRM DELETE MODAL */}
        {confirmDeleteIndex !== null && cart[confirmDeleteIndex] && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDeleteIndex(null)}
            />
            <motion.div
              className="bg-white rounded-3xl w-full max-w-sm flex flex-col overflow-hidden z-[61] shadow-2xl"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
            >
              <div className="p-6 text-center pt-8">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-red-500 text-3xl mx-auto mb-4">
                  🗑️
                </div>
                <h2 className="text-xl font-bold mb-2">Hapus dari Keranjang?</h2>
                <p className="text-gray-500 text-sm">
                  Apakah Anda yakin ingin menghapus <strong className="text-gray-800">{cart[confirmDeleteIndex].product.name}</strong> dari pesanan Anda?
                </p>
              </div>
              <div className="p-4 bg-gray-50 flex gap-3 border-t border-gray-100">
                <button
                  className="flex-1 py-3.5 rounded-xl font-bold text-gray-600 bg-white border shadow-sm active:scale-95 transition-transform"
                  onClick={() => setConfirmDeleteIndex(null)}
                >
                  Batal
                </button>
                <button
                  className="flex-1 py-3.5 rounded-xl font-bold text-white bg-red-500 shadow-sm shadow-red-500/30 active:scale-95 transition-transform"
                  onClick={confirmRemoveAction}
                >
                  Hapus
                </button>
              </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>
    </div>
  );
}
