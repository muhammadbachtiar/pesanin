"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Table, Tag, Button, Modal, Form, Input, Select, Badge, Tabs, Switch, InputNumber, Drawer } from "antd";
import { getOrdersByTenant, getOrderById, markOrderPaid, approveOrder, voidOrder, updateOrderStatus, createOrder, generateQueueNumber } from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { getAllProductsByTenant, getCategoriesWithProducts } from "@/services/productService";
import { getCurrentProfile } from "@/services/authService";
import { toggleProductAvailability } from "@/services/productService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import type { Order, Tenant, Profile, Product, CartItem, PaymentMethodType, Category } from "@/types";

const STATUS_COLOR: Record<string, string> = {
  pending: "orange", cooking: "blue", ready: "green",
  completed: "default", cancelled: "red",
};
const PAY_COLOR: Record<string, string> = { unpaid: "red", paid: "green", refunded: "orange" };

export default function CashierPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [voidModal, setVoidModal] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: "" });
  const [payModal, setPayModal] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: "" });
  const [newOrderDrawer, setNewOrderDrawer] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingBadge, setPendingBadge] = useState(0);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [voidForm] = Form.useForm();
  const [payForm] = Form.useForm();

  const refreshOrders = useCallback(async (tenantId: string) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const data = await getOrdersByTenant(tenantId, undefined, startOfToday.toISOString(), endOfToday.toISOString());
    setOrders(data);
    setPendingBadge(
      data.filter(
        (o) =>
          o.order_status === "pending" &&
          (o.payment_status === "unpaid" || o.verification_status === "unverified")
      ).length
    );
  }, []);

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const [t, p] = await Promise.all([getTenantBySlug(tenant_slug), getCurrentProfile()]);
      if (!t || !p) return;
      setTenant(t);
      setProfile(p);
      const [allProds, cats] = await Promise.all([
        getAllProductsByTenant(t.id),
        getCategoriesWithProducts(t.id),
        refreshOrders(t.id),
      ]);
      setProducts(allProds);
      setCategories(cats);
    }
    init();
  }, [params, refreshOrders]);

  useRealtimeOrders(
    tenant?.id ?? "",
    async (newOrder) => {
      // Realtime payload doesn't include joined items — fetch full order
      const full = await getOrderById(newOrder.id);
      const order = full ?? newOrder;
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
      if (order.order_status === "pending" &&
        (order.payment_status === "unpaid" || order.verification_status === "unverified")) {
        setPendingBadge((n) => n + 1);
      }
    },
    async (updated) => {
      const full = await getOrderById(updated.id);
      const order = full ?? updated;
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
      // Recalculate pending badge from current orders state
      setPendingBadge((n) => {
        const wasPending = updated.order_status === "pending";
        const isNowPending = order.order_status === "pending";
        if (!wasPending && isNowPending) return n + 1;
        if (wasPending && !isNowPending) return Math.max(0, n - 1);
        return n;
      });
    },
    () => "new",
    (order) => order.order_status === "ready" ? "ready" : false
  );

  const handleVoid = async (values: { reason: string }) => {
    if (!profile) return;
    await voidOrder(voidModal.orderId, values.reason, profile.id);
    setVoidModal({ open: false, orderId: "" });
    voidForm.resetFields();
    if (tenant) refreshOrders(tenant.id);
  };

  const handlePay = async (values: { method: PaymentMethodType }) => {
    if (!profile) return;
    await markOrderPaid(payModal.orderId, values.method, profile.id);
    setPayModal({ open: false, orderId: "" });
    payForm.resetFields();
    if (tenant) refreshOrders(tenant.id);
  };

  const handleApprove = async (orderId: string) => {
    if (!profile) return;
    await approveOrder(orderId, profile.id);
    if (tenant) refreshOrders(tenant.id);
  };

  const handleReadyToComplete = async (orderId: string) => {
    await updateOrderStatus(orderId, "completed");
    if (tenant) refreshOrders(tenant.id);
  };

  // ──────────────────────────────── POS Cart helpers ────────────────────────────────
  const addToCart = (product: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1, selected_variants: [], notes: "", unit_price: product.base_price }];
    });
  };

  const setCartQty = (index: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: qty };
      return next;
    });
  };

  const setCartNotes = (index: number, notes: string) => {
    setCart((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], notes };
      return next;
    });
  };

  const cartSubtotal = cart.reduce((s, c) => s + c.unit_price * c.quantity, 0);
  const fc = tenant?.finance_config;
  const cartTax = fc ? Math.round(cartSubtotal * fc.tax_percentage / 100) : 0;
  const cartSvc = fc ? Math.round(cartSubtotal * fc.service_charge_percentage / 100) : 0;
  const cartTkwy = (orderType === "takeaway" && fc) ? fc.takeaway_fee : 0;
  const cartTotal = cartSubtotal + cartTax + cartSvc + cartTkwy;

  const handleCreateCashierOrder = async () => {
    if (!tenant || !profile || cart.length === 0) return;
    const qn = await generateQueueNumber(tenant.id);
    await createOrder(
      {
        tenant_id: tenant.id,
        queue_number: qn,
        table_number: tableNumber || undefined,
        order_type: orderType,
        subtotal: cartSubtotal,
        tax_amount: cartTax,
        service_charge_amount: cartSvc,
        takeaway_fee_amount: cartTkwy,
        total_amount: cartTotal,
        customer_notes: customerNotes || undefined,
        created_by_cashier: true,
        cashier_profile_id: profile.id,
        finance_snapshot: {
          tax_percentage: fc?.tax_percentage ?? 0,
          service_charge_percentage: fc?.service_charge_percentage ?? 0,
          takeaway_fee: fc?.takeaway_fee ?? 0,
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
    setCart([]);
    setTableNumber("");
    setCustomerNotes("");
    setOrderType("dine_in");
    setNewOrderDrawer(false);
    if (tenant) refreshOrders(tenant.id);
  };

  // ──────────────────────────── Filtered product list ───────────────────────────────
  const visibleProducts = products.filter((p) => {
    const matchCat = selectedCat ? p.category_id === selectedCat : true;
    const matchQ = p.name.toLowerCase().includes(productSearch.toLowerCase());
    return p.is_available && matchCat && matchQ;
  });

  const bl = tenant?.business_logic;
  const showPendingTab = bl?.payment_timing === "postpaid" || bl?.payment_mode === "manual";

  const columns = [
    {
      title: "Antrian / Meja",
      width: 140,
      render: (_: unknown, r: Order) => (
        <div className="flex flex-col gap-1">
          <span className="font-black text-2xl leading-none" style={{ color: "var(--tenant-primary)" }}>
            #{r.queue_number}
          </span>
          {r.table_number && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 w-fit">
              🪑 Meja {r.table_number}
            </span>
          )}
          <div className="flex gap-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider rounded w-fit ${r.created_by_cashier ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
              {r.created_by_cashier ? "KASIR" : "KIOSK"}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider rounded w-fit ${r.order_type === "takeaway" ? "bg-orange-100 text-orange-700" : "bg-teal-100 text-teal-700"}`}>
              {r.order_type === "takeaway" ? "TAKEAWAY" : "DINE-IN"}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: "Item Pesanan",
      render: (_: unknown, r: Order) => (
        <div className="text-sm space-y-1">
          {r.items && r.items.length > 0 ? r.items.map((it, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="font-bold text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
                ×{it.quantity}
              </span>
              <div>
                <span className="font-medium">{it.product_name_snapshot}</span>
                {it.notes && (
                  <span className="block text-xs text-amber-600">📝 {it.notes}</span>
                )}
              </div>
            </div>
          )) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
          {r.customer_notes && (
            <div className="mt-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
              🗒️ {r.customer_notes}
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Status",
      width: 120,
      render: (_: unknown, r: Order) => (
        <div className="flex flex-col gap-1">
          <Tag color={STATUS_COLOR[r.order_status]}>{r.order_status.toUpperCase()}</Tag>
          <Tag color={PAY_COLOR[r.payment_status]}>{r.payment_status.toUpperCase()}</Tag>
        </div>
      ),
    },
    {
      title: "Total",
      width: 110,
      render: (_: unknown, r: Order) => (
        <span className="font-semibold text-sm">Rp {r.total_amount.toLocaleString("id-ID")}</span>
      ),
    },
    {
      title: "Aksi",
      width: 170,
      render: (_: unknown, r: Order) => (
        <div className="flex flex-wrap gap-1">
          {r.payment_status === "unpaid" && r.order_status !== "cancelled" && (
            <Button type="primary" size="small" onClick={() => setPayModal({ open: true, orderId: r.id })}>
              Tandai Lunas
            </Button>
          )}
          {bl?.payment_timing === "postpaid" && bl.require_cashier_verification &&
            r.verification_status === "unverified" && r.order_status === "pending" && (
            <Button
              size="small"
              style={{ background: "#22c55e", color: "#fff", border: "none" }}
              onClick={() => Modal.confirm({
                title: "Terima pesanan ini? Pesanan akan diteruskan ke dapur",
                onOk: () => handleApprove(r.id),
              })}
            >
              Terima
            </Button>
          )}
          {r.order_status === "ready" && (
            <Button
              size="small"
              style={{ background: "#3b82f6", color: "#fff", border: "none" }}
              onClick={() => Modal.confirm({
                title: "Tandai pesanan sudah diambil?",
                onOk: () => handleReadyToComplete(r.id),
              })}
            >
              ✅ Selesai
            </Button>
          )}
          {r.order_status !== "cancelled" && r.order_status !== "completed" && (
            <Button danger size="small" onClick={() => setVoidModal({ open: true, orderId: r.id })}>
              Void
            </Button>
          )}
        </div>
      ),
    },
  ];

  const filterOrders = (statuses: Order["order_status"][], payStatuses?: Order["payment_status"][]) =>
    orders.filter(
      (o) =>
        statuses.includes(o.order_status) &&
        (payStatuses ? payStatuses.includes(o.payment_status) : true)
    );

  if (!tenant) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9" }}>
      {/* ─── Header ─── */}
      <header
        className="px-6 py-4 flex items-center justify-between shadow-md gap-4"
        style={{ background: "var(--tenant-primary)" }}
      >
        <div className="flex-1">
          <h1 className="text-white font-bold text-xl leading-none">{tenant.name}</h1>
          <p className="text-white/70 text-sm mt-0.5">
            Layar Kasir · <span className="font-semibold">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="analytics"
            className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-medium border border-white/30 px-3 py-2 rounded-xl hover:bg-white/10 transition-all"
          >
            📊 Analitik
          </a>
          <button
            onClick={() => setNewOrderDrawer(true)}
            className="flex items-center gap-2 bg-white font-bold text-sm px-4 py-2 rounded-xl shadow hover:shadow-md active:scale-95 transition-all"
            style={{ color: "var(--tenant-primary)" }}
          >
            <span className="text-lg leading-none">＋</span> Pesanan Baru
          </button>
        </div>
      </header>

      {/* ─── Tab content ─── */}
      <div className="p-4 md:p-6">
        <Tabs
          defaultActiveKey="pending"
          type="card"
          items={[
            ...(showPendingTab ? [{
              key: "pending",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Menunggu
                  {pendingBadge > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white leading-none">{pendingBadge}</span>
                  )}
                </span>
              ),
              children: (
                <Table dataSource={filterOrders(["pending"])} columns={columns} rowKey="id" size="middle" scroll={{ x: 800 }} />
              ),
            }] : []),
            {
              key: "cooking",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Sedang Dimasak
                  {filterOrders(["cooking"]).length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-blue-500 text-white leading-none">{filterOrders(["cooking"]).length}</span>
                  )}
                </span>
              ),
              children: (
                <Table dataSource={filterOrders(["cooking"])} columns={columns} rowKey="id" size="middle" scroll={{ x: 800 }} />
              ),
            },
            {
              key: "ready",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Siap Ambil
                  {filterOrders(["ready"]).length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-green-500 text-white leading-none">{filterOrders(["ready"]).length}</span>
                  )}
                </span>
              ),
              children: (
                <Table dataSource={filterOrders(["ready"])} columns={columns} rowKey="id" size="middle" scroll={{ x: 800 }} />
              ),
            },
            {
              key: "done",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Selesai &amp; Void
                  {filterOrders(["completed", "cancelled"]).length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-blue-400 text-white leading-none">
                      {filterOrders(["completed", "cancelled"]).length > 999 ? "999+" : filterOrders(["completed", "cancelled"]).length}
                    </span>
                  )}
                </span>
              ),
              children: (
                <Table dataSource={filterOrders(["completed", "cancelled"])} columns={columns} rowKey="id" size="middle" scroll={{ x: 800 }} />
              ),
            },
            {
              key: "stock",
              label: "Produk & Stok",
              children: (
                <Table
                  dataSource={products}
                  rowKey="id"
                  size="middle"
                  columns={[
                    { title: "Produk", dataIndex: "name", key: "name" },
                    {
                      title: "Stok",
                      render: (_: unknown, r: Product) => (
                        <InputNumber
                          value={r.stock_count ?? undefined}
                          placeholder="∞"
                          min={0}
                          onChange={async (val) => {
                            await toggleProductAvailability(r.id, (val ?? 0) > 0, val ?? null);
                            if (tenant) {
                              const fresh = await getAllProductsByTenant(tenant.id);
                              setProducts(fresh);
                            }
                          }}
                        />
                      ),
                    },
                    {
                      title: "Tersedia",
                      render: (_: unknown, r: Product) => (
                        <Switch
                          checked={r.is_available}
                          onChange={async (v) => {
                            await toggleProductAvailability(r.id, v);
                            if (tenant) {
                              const fresh = await getAllProductsByTenant(tenant.id);
                              setProducts(fresh);
                            }
                          }}
                        />
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>

      {/* ─── Void Modal ─── */}
      <Modal
        title="Batalkan Pesanan (Void)"
        open={voidModal.open}
        onCancel={() => setVoidModal({ open: false, orderId: "" })}
        onOk={() => voidForm.submit()}
        okText="Void"
        okButtonProps={{ danger: true }}
      >
        <Form form={voidForm} onFinish={handleVoid} layout="vertical">
          <Form.Item name="reason" label="Alasan pembatalan" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Tuliskan alasan..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* ─── Pay Modal ─── */}
      <Modal
        title="Tandai Lunas"
        open={payModal.open}
        onCancel={() => setPayModal({ open: false, orderId: "" })}
        onOk={() => payForm.submit()}
        okText="Konfirmasi Lunas"
      >
        <Form form={payForm} onFinish={handlePay} layout="vertical">
          <Form.Item name="method" label="Metode Pembayaran" rules={[{ required: true }]}>
            <Select placeholder="Pilih metode">
              {tenant.manual_payment_channels.map((ch) => (
                <Select.Option key={ch.id} value={ch.type}>{ch.label}</Select.Option>
              ))}
              {bl?.payment_mode === "gateway" && (
                <Select.Option value="gateway">Gateway (Midtrans/Xendit)</Select.Option>
              )}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* ──────────────── POS ORDER DRAWER ──────────────── */}
      <Drawer
        title={null}
        placement="right"
        size="large"
        open={newOrderDrawer}
        onClose={() => { setNewOrderDrawer(false); setCart([]); setTableNumber(""); setCustomerNotes(""); setOrderType("dine_in"); }}
        styles={{ body: { padding: 0 }, header: { display: "none" } }}
      >
        {/* Two-column POS layout */}
        <div className="flex h-full min-h-screen" style={{ fontFamily: "Inter, sans-serif" }}>

          {/* ── LEFT: Product panel ── */}
          <div className="flex flex-col w-[55%] border-r bg-gray-50">
            {/* Panel header */}
            <div className="px-4 pt-4 pb-3 bg-white border-b shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-gray-800">Pilih Menu</h2>
                <button onClick={() => { setNewOrderDrawer(false); setCart([]); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
              {/* Search */}
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="🔍  Cari nama menu..."
                className="w-full text-sm px-3 py-2 border rounded-lg bg-gray-50 outline-none focus:border-blue-400 transition-colors"
              />
              {/* Category tabs */}
              {categories.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setSelectedCat(null)}
                    className="whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 transition-all"
                    style={!selectedCat ? { background: "var(--tenant-primary)", color: "#fff" } : { background: "#e2e8f0", color: "#64748b" }}
                  >
                    Semua
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCat(cat.id)}
                      className="whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0 transition-all"
                      style={selectedCat === cat.id ? { background: "var(--tenant-primary)", color: "#fff" } : { background: "#e2e8f0", color: "#64748b" }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product grid */}
            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 lg:grid-cols-3 gap-2.5 content-start">
              {visibleProducts.length === 0 && (
                <div className="col-span-full py-16 flex flex-col items-center text-gray-400">
                  <span className="text-4xl mb-2">🍽️</span>
                  <p className="text-sm">Tidak ada menu yang ditemukan</p>
                </div>
              )}
              {visibleProducts.map((p) => {
                const inCart = cart.filter((c) => c.product.id === p.id).reduce((s, c) => s + c.quantity, 0);
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="relative text-left rounded-xl overflow-hidden border bg-white hover:shadow-md active:scale-95 transition-all flex flex-col"
                    style={{
                      borderColor: inCart > 0 ? "var(--tenant-primary)" : "#e2e8f0",
                      boxShadow: inCart > 0 ? "0 0 0 2px rgba(99,102,241,.15)" : undefined,
                    }}
                  >
                    {inCart > 0 && (
                      <span
                        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                        style={{ background: "var(--tenant-primary)" }}
                      >
                        {inCart}
                      </span>
                    )}
                    {p.image_urls[0] ? (
                      <div className="w-full bg-gray-50 flex items-center justify-center" style={{ height: 90 }}>
                        <img src={p.image_urls[0]} alt={p.name} className="w-full h-full object-contain p-1" />
                      </div>
                    ) : (
                      <div className="w-full flex items-center justify-center text-3xl" style={{ height: 90, background: "#f8fafc" }}>🍽️</div>
                    )}
                    <div className="p-2 flex flex-col flex-1">
                      <p className="font-semibold text-xs leading-tight line-clamp-2 mb-1">{p.name}</p>
                      <p className="text-[11px] font-bold mt-auto" style={{ color: "var(--tenant-primary)" }}>
                        Rp {Number(p.base_price).toLocaleString("id-ID")}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT: Cart + order details ── */}
          <div className="flex flex-col w-[45%] bg-white">
            {/* Cart header */}
            <div className="px-4 py-3 border-b bg-gray-50 shadow-sm">
              <h2 className="text-base font-bold text-gray-800">Pesanan</h2>
            </div>

            {/* Order type + table + notes */}
            <div className="px-4 pt-3 pb-2 border-b space-y-2.5 bg-white">
              {/* Order type toggle */}
              <div className="flex gap-2">
                {(["dine_in", "takeaway"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold border transition-all"
                    style={
                      orderType === t
                        ? { background: "var(--tenant-primary)", color: "#fff", border: "1.5px solid var(--tenant-primary)" }
                        : { background: "#fff", color: "#64748b", border: "1.5px solid #e2e8f0" }
                    }
                  >
                    {t === "dine_in" ? "🍽️  Dine-In" : "🛍️  Takeaway"}
                  </button>
                ))}
              </div>
              {/* Table number */}
              <input
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="Nomor Meja (opsional)"
                className="w-full text-sm px-3 py-2 border rounded-lg outline-none focus:border-blue-400 transition-colors"
              />
              {/* Customer notes */}
              <textarea
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="Catatan pesanan (opsional)"
                rows={2}
                className="w-full text-sm px-3 py-2 border rounded-lg outline-none focus:border-blue-400 transition-colors resize-none"
              />
            </div>

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {cart.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                  <span className="text-4xl mb-2">🛒</span>
                  <p className="text-sm">Keranjang kosong</p>
                  <p className="text-xs mt-1">Klik item di sebelah kiri untuk menambahkan</p>
                </div>
              )}
              {cart.map((item, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 flex-1">
                      {item.product.image_urls[0] ? (
                        <div className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden bg-white border flex items-center justify-center">
                          <img src={item.product.image_urls[0]} alt={item.product.name} className="w-full h-full object-contain p-0.5" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-lg">🍽️</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs leading-tight line-clamp-2">{item.product.name}</p>
                        <p className="text-[11px] font-bold" style={{ color: "var(--tenant-primary)" }}>
                          Rp {item.unit_price.toLocaleString("id-ID")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <p className="text-xs font-bold text-gray-700">
                        Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                      </p>
                      <button
                        onClick={() => setCart((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 text-[10px] font-bold"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                  {/* Qty stepper */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-white border rounded-lg px-1.5 py-1">
                      <button
                        onClick={() => setCartQty(i, item.quantity - 1)}
                        className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-600 text-sm leading-none"
                      >−</button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => setCartQty(i, parseInt(e.target.value) || 1)}
                        className="w-8 text-center text-sm font-bold bg-transparent outline-none"
                      />
                      <button
                        onClick={() => setCartQty(i, item.quantity + 1)}
                        className="w-6 h-6 rounded-md text-white flex items-center justify-center font-bold text-sm leading-none"
                        style={{ background: "var(--tenant-primary)" }}
                      >+</button>
                    </div>
                    <input
                      value={item.notes || ""}
                      onChange={(e) => setCartNotes(i, e.target.value)}
                      placeholder="Catatan item (pedas, dsb)"
                      className="flex-1 text-xs px-2 py-1.5 bg-white border rounded-lg outline-none focus:border-blue-400 transition-colors placeholder-gray-300"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Totals + submit */}
            <div className="border-t px-4 py-3 space-y-2 bg-white">
              {cart.length > 0 && (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal</span>
                    <span>Rp {cartSubtotal.toLocaleString("id-ID")}</span>
                  </div>
                  {cartTax > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Pajak ({fc?.tax_percentage}%)</span>
                      <span>Rp {cartTax.toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  {cartSvc > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Service ({fc?.service_charge_percentage}%)</span>
                      <span>Rp {cartSvc.toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  {cartTkwy > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Biaya Takeaway</span>
                      <span>Rp {cartTkwy.toLocaleString("id-ID")}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-1 border-t">
                    <span>Total</span>
                    <span style={{ color: "var(--tenant-primary)" }}>Rp {cartTotal.toLocaleString("id-ID")}</span>
                  </div>
                </div>
              )}
              <button
                onClick={handleCreateCashierOrder}
                disabled={cart.length === 0}
                className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: cart.length > 0 ? "var(--tenant-primary)" : "#94a3b8" }}
              >
                {cart.length === 0 ? "Pilih Menu Terlebih Dahulu" : `Buat Pesanan · Rp ${cartTotal.toLocaleString("id-ID")}`}
              </button>
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
