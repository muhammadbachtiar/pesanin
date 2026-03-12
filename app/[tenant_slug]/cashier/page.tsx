"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Table, Tag, Button, Modal, Form, Input, Select, Badge, Tabs, Switch, InputNumber, Drawer } from "antd";
import { getOrdersByTenant, markOrderPaid, approveOrder, voidOrder, updateOrderStatus, createOrder, generateQueueNumber } from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { getAllProductsByTenant } from "@/services/productService";
import { getCurrentProfile } from "@/services/authService";
import { toggleProductAvailability } from "@/services/productService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import type { Order, Tenant, Profile, Product, CartItem, PaymentMethodType } from "@/types";



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
  const [voidModal, setVoidModal] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: "" });
  const [payModal, setPayModal] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: "" });
  const [newOrderDrawer, setNewOrderDrawer] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingBadge, setPendingBadge] = useState(0);
  const [voidForm] = Form.useForm();
  const [payForm] = Form.useForm();
  const [newOrderForm] = Form.useForm();

  const refreshOrders = useCallback(async (tenantId: string) => {
    const data = await getOrdersByTenant(tenantId);
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
      const [allProds] = await Promise.all([
        getAllProductsByTenant(t.id),
        refreshOrders(t.id),
      ]);
      setProducts(allProds);
    }
    init();
  }, [params, refreshOrders]);

  useRealtimeOrders(
    tenant?.id ?? "",
    (newOrder) => {
      setOrders((prev) => [newOrder, ...prev]);
      setPendingBadge((n) => n + 1);
    },
    (updated) => {
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    },
    // Beep untuk semua pesanan baru
    () => "new",
    // Beep jika pesanan update ke status 'ready' (selesai dimasak)
    (order) => order.order_status === "ready" ? "ready" : false  );

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

  const handleCreateCashierOrder = async (values: { table_number?: string; notes?: string }) => {
    if (!tenant || !profile) return;
    const subtotal = cart.reduce((s, c) => s + c.unit_price * c.quantity, 0);
    const fc = tenant.finance_config;
    const tax = Math.round(subtotal * fc.tax_percentage / 100);
    const svc = Math.round(subtotal * fc.service_charge_percentage / 100);
    const total = subtotal + tax + svc;
    const qn = await generateQueueNumber(tenant.id);
    await createOrder(
      {
        tenant_id: tenant.id,
        queue_number: qn,
        table_number: values.table_number,
        order_type: "dine_in",
        subtotal, tax_amount: tax,
        service_charge_amount: svc,
        takeaway_fee_amount: 0,
        total_amount: total,
        customer_notes: values.notes,
        created_by_cashier: true,
        cashier_profile_id: profile.id,
        finance_snapshot: { tax_percentage: fc.tax_percentage, service_charge_percentage: fc.service_charge_percentage, takeaway_fee: fc.takeaway_fee },
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
    newOrderForm.resetFields();
    setNewOrderDrawer(false);
    if (tenant) refreshOrders(tenant.id);
  };

  const bl = tenant?.business_logic;
  const showPendingTab = bl?.payment_timing === "postpaid" || bl?.payment_mode === "manual";

  const columns = [
    {
      title: "Antrian / Meja",
      width: 130,
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
          <div className="flex gap-1">
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
          {r.order_type === "takeaway" && <Tag color="orange">Takeaway</Tag>}
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
      width: 160,
      render: (_: unknown, r: Order) => (
        <div className="flex flex-wrap gap-1">
          {r.payment_status === "unpaid" && r.order_status !== "cancelled" && (
            <Button
              type="primary"
              size="small"
              onClick={() => setPayModal({ open: true, orderId: r.id })}
            >
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
            <Button
              danger
              size="small"
              onClick={() => setVoidModal({ open: true, orderId: r.id })}
            >
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
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <header
        className="px-6 py-4 flex items-center justify-between shadow-sm"
        style={{ background: "var(--tenant-primary)" }}
      >
        <div>
          <h1 className="text-white font-bold text-xl">{tenant.name}</h1>
          <p className="text-white/70 text-sm">Layar Kasir</p>
        </div>
        <Button
          type="primary"
          size="large"
          ghost
          onClick={() => setNewOrderDrawer(true)}
          style={{ borderColor: "#fff", color: "#fff" }}
        >
          + Tambah Pesanan
        </Button>
      </header>

      <div className="p-6">
        <Tabs
          defaultActiveKey="pending"
          items={[
            ...(showPendingTab ? [{
              key: "pending",
              label: (
                <Badge count={pendingBadge} offset={[10, 0]}>
                  <span>Menunggu</span>
                </Badge>
              ),
              children: (
                <Table
                  dataSource={filterOrders(["pending"])}
                  columns={columns}
                  rowKey="id"
                  size="middle"
                />
              ),
            }] : []),
            {
              key: "cooking",
              label: (
                <Badge count={filterOrders(["cooking"]).length} offset={[10, 0]} color="blue">
                  <span>Sedang Dimasak</span>
                </Badge>
              ),
              children: (
                <Table
                  dataSource={filterOrders(["cooking"])}
                  columns={columns}
                  rowKey="id"
                  size="middle"
                />
              ),
            },
            {
              key: "ready",
              label: (
                <Badge count={filterOrders(["ready"]).length} offset={[10, 0]} color="green">
                  <span>Siap Ambil</span>
                </Badge>
              ),
              children: (
                <Table
                  dataSource={filterOrders(["ready"])}
                  columns={columns}
                  rowKey="id"
                  size="middle"
                />
              ),
            },
            {
              key: "done",
              label: (
                <Badge count={filterOrders(["completed", "cancelled"]).length} offset={[10, 0]} color="#1677ff" overflowCount={999}>
                  <span>Selesai & Void</span>
                </Badge>
              ),
              children: (
                <Table
                  dataSource={filterOrders(["completed", "cancelled"])}
                  columns={columns}
                  rowKey="id"
                  size="middle"
                />
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

      {/* Void Modal */}
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

      {/* Pay Modal */}
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
                <Select.Option key={ch.id} value={ch.type}>
                  {ch.label}
                </Select.Option>
              ))}
              {bl?.payment_mode === "gateway" && (
                <Select.Option value="gateway">Gateway (Midtrans/Xendit)</Select.Option>
              )}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* New Order Drawer */}
      <Drawer
        title="Input Pesanan Manual"
        placement="right"
        size="large"
        open={newOrderDrawer}
        onClose={() => { setNewOrderDrawer(false); setCart([]); }}
        footer={
          <div className="flex gap-2">
            <Button block onClick={() => { setNewOrderDrawer(false); setCart([]); }}>
              Batal
            </Button>
            <Button
              type="primary"
              block
              disabled={cart.length === 0}
              onClick={() => newOrderForm.submit()}
            >
              Buat Pesanan
            </Button>
          </div>
        }
      >
        <Form form={newOrderForm} onFinish={handleCreateCashierOrder} layout="vertical">
          <Form.Item name="table_number" label="Nomor Meja (opsional)">
            <Input placeholder="01" />
          </Form.Item>
          <Form.Item name="notes" label="Catatan">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>

        <div className="mt-4">
          <p className="font-semibold mb-2">Pilih Menu</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {products.filter((p) => p.is_available).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b">
                <div>
                  <p className="font-medium text-sm">{p.name}</p>
                  <p className="text-xs text-gray-500">Rp {p.base_price.toLocaleString("id-ID")}</p>
                </div>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    const existing = cart.find((c) => c.product.id === p.id);
                    setCart(
                      existing
                        ? cart.map((c) => c.product.id === p.id ? { ...c, quantity: c.quantity + 1 } : c)
                        : [...cart, { product: p, quantity: 1, selected_variants: [], notes: "", unit_price: p.base_price }]
                    );
                  }}
                >
                  + Tambah
                </Button>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="mt-4 border-t pt-3 space-y-2">
              <p className="font-semibold">Keranjang</p>
              {cart.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{item.product.name} ×{item.quantity}</span>
                  <span>Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}</span>
                  <Button size="small" danger onClick={() => setCart(cart.filter((_, idx) => idx !== i))}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex justify-between font-bold pt-2 border-t">
                <span>Total</span>
                <span>Rp {cart.reduce((s, c) => s + c.unit_price * c.quantity, 0).toLocaleString("id-ID")}</span>
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
