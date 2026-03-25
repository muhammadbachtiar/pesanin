"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Table, Tag, DatePicker, Button, Tabs, Modal, Spin } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { getTenantBySlug } from "@/services/tenantService";
import { getOrdersForAnalytics, getOrderById } from "@/services/orderService";
import type { Tenant, Order } from "@/types";

const { RangePicker } = DatePicker;

// ──────────── helpers ────────────
function startOf(d: Dayjs) {
  return d.startOf("day").toISOString();
}
function endOf(d: Dayjs) {
  return d.endOf("day").toISOString();
}
function fmt(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

const ORDER_STATUS_COLOR: Record<string, string> = {
  pending: "orange", cooking: "blue", ready: "cyan",
  completed: "green", cancelled: "red",
};

// ──────────── Stat card ────────────
function StatCard({
  label, value, sub, color = "var(--tenant-primary)",
}: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black leading-tight" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ──────────── Simple bar chart (no lib) ────────────
function MiniBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-32 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div
            className="w-full rounded-t-md transition-all"
            style={{
              height: `${Math.max(4, (d.value / max) * 112)}px`,
              background: "var(--tenant-primary)",
              opacity: d.value > 0 ? 1 : 0.15,
            }}
            title={fmt(d.value)}
          />
          <span className="text-[9px] text-gray-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ──────────── Donut chart (no lib) ────────────
function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  let cursor = 0;
  const r = 42, cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;

  const paths = slices.map((s) => {
    const pct = total ? s.value / total : 0;
    const dash = pct * circumference;
    const gap = circumference - dash;
    const offset = -cursor * circumference;
    cursor += pct;
    return { ...s, pct, dash, gap, offset };
  });

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="w-28 h-28 flex-shrink-0 -rotate-90">
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        ) : (
          paths.map((p, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="12"
              strokeDasharray={`${p.dash} ${p.gap}`}
              strokeDashoffset={p.offset}
            />
          ))
        )}
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="rotate-90" style={{ fontSize: 14, fill: "#374151", fontWeight: 700, transform: "rotate(90deg)", transformOrigin: "50px 50px" }}>
          {total}
        </text>
      </svg>
      <div className="space-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-gray-600">{s.label}</span>
            <span className="font-bold text-gray-800 ml-auto pl-3">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────── Page ────────────
export default function AnalyticsPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const t = await getTenantBySlug(tenant_slug);
      if (t) setTenant(t);
    }
    init();
  }, [params]);

  const fetchData = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const data = await getOrdersForAnalytics(tenant.id, startOf(range[0]), endOf(range[1]));
    setOrders(data);
    setLoading(false);
  }, [tenant, range]);

  useEffect(() => {
    if (tenant) fetchData();
  }, [tenant, fetchData]);

  const openDetail = useCallback(async (order: Order) => {
    setSelectedOrder(order);
    setDetailLoading(true);
    const full = await getOrderById(order.id);
    if (full) setSelectedOrder(full);
    setDetailLoading(false);
  }, []);

  // ── KPIs ──
  const completed = useMemo(() => orders.filter((o) => o.order_status === "completed"), [orders]);
  const cancelled = useMemo(() => orders.filter((o) => o.order_status === "cancelled"), [orders]);
  const revenue = useMemo(() => completed.reduce((s, o) => s + (o.total_amount ?? 0), 0), [completed]);
  const avgOrder = completed.length ? Math.round(revenue / completed.length) : 0;

  // ── Daily chart data ──
  const dailyData = useMemo(() => {
    const days: { label: string; value: number }[] = [];
    let cur = range[0].clone();
    while (cur.isBefore(range[1].add(1, "day"), "day")) {
      const label = cur.format("DD/MM");
      const value = completed
        .filter((o) => dayjs(o.created_at).isSame(cur, "day"))
        .reduce((s, o) => s + (o.total_amount ?? 0), 0);
      days.push({ label, value });
      cur = cur.add(1, "day");
    }
    return days;
  }, [completed, range]);

  // ── Order type breakdown ──
  const donutSlices = useMemo(() => [
    { label: "Dine-in", value: orders.filter((o) => o.order_type === "dine_in" && o.order_status === "completed").length, color: "#6366f1" },
    { label: "Takeaway", value: orders.filter((o) => o.order_type === "takeaway" && o.order_status === "completed").length, color: "#f59e0b" },
    { label: "Dibatalkan", value: cancelled.length, color: "#f87171" },
  ], [orders, cancelled]);

  const columns = [
    {
      title: "Waktu",
      width: 120,
      render: (_: unknown, r: Order) => (
        <span className="text-xs text-gray-500">{dayjs(r.created_at).format("DD/MM HH:mm")}</span>
      ),
    },
    {
      title: "Antrian",
      width: 80,
      render: (_: unknown, r: Order) => (
        <span className="font-black text-base" style={{ color: "var(--tenant-primary)" }}>#{r.queue_number}</span>
      ),
    },
    {
      title: "Tipe",
      width: 120,
      render: (_: unknown, r: Order) => (
        <div className="flex flex-col gap-0.5">
          <Tag color={r.order_type === "takeaway" ? "orange" : "teal"}>{r.order_type === "takeaway" ? "Takeaway" : "Dine-in"}</Tag>
          {r.table_number && <span className="text-xs text-gray-400">🪑 Meja {r.table_number}</span>}
        </div>
      ),
    },
    {
      title: "Status",
      width: 110,
      render: (_: unknown, r: Order) => (
        <Tag color={ORDER_STATUS_COLOR[r.order_status]}>{r.order_status.toUpperCase()}</Tag>
      ),
    },
    {
      title: "Total",
      width: 130,
      render: (_: unknown, r: Order) => (
        <span className={`font-semibold text-sm ${r.order_status === "cancelled" ? "text-gray-400 line-through" : ""}`}>
          {fmt(r.total_amount ?? 0)}
        </span>
      ),
    },
    {
      title: "",
      width: 80,
      render: (_: unknown, r: Order) => (
        <button
          onClick={() => openDetail(r)}
          className="text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
        >
          Detail
        </button>
      ),
    },
  ];

  if (!tenant) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between shadow-md" style={{ background: "var(--tenant-primary)" }}>
        <div>
          <h1 className="text-white font-bold text-xl leading-none">{tenant.name}</h1>
          <p className="text-white/70 text-sm mt-0.5">Analitik &amp; Riwayat Revenue</p>
        </div>
        <a href={`/${(tenant as unknown as { slug: string }).slug ?? ""}/cashier`} className="text-white/80 text-sm hover:text-white transition-colors">
          ← Kembali ke Kasir
        </a>
      </header>

      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">

        {/* Date range filter */}
        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-600">Rentang Tanggal:</span>
          <RangePicker
            value={range}
            onChange={(v) => { if (v && v[0] && v[1]) setRange([v[0], v[1]]); }}
            format="DD MMM YYYY"
            allowClear={false}
            presets={[
              { label: "Hari Ini", value: [dayjs(), dayjs()] },
              { label: "Kemarin", value: [dayjs().subtract(1, "day"), dayjs().subtract(1, "day")] },
              { label: "7 Hari", value: [dayjs().subtract(6, "day"), dayjs()] },
              { label: "30 Hari", value: [dayjs().subtract(29, "day"), dayjs()] },
              { label: "Bulan Ini", value: [dayjs().startOf("month"), dayjs()] },
            ]}
          />
          <Button
            type="primary"
            loading={loading}
            onClick={fetchData}
            style={{ background: "var(--tenant-primary)", border: "none" }}
          >
            Tampilkan
          </Button>
          <span className="text-xs text-gray-400 ml-auto">
            {orders.length} pesanan ditemukan
          </span>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Revenue" value={fmt(revenue)} sub={`${completed.length} pesanan selesai`} />
          <StatCard label="Rata-rata Pesanan" value={fmt(avgOrder)} sub="dari pesanan selesai" color="#10b981" />
          <StatCard label="Total Pesanan" value={String(orders.length)} sub={`${cancelled.length} dibatalkan`} color="#6366f1" />
          <StatCard
            label="Tingkat Penyelesaian"
            value={orders.length ? `${Math.round((completed.length / orders.length) * 100)}%` : "—"}
            sub="pesanan selesai vs total"
            color="#f59e0b"
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* bar chart */}
          <div className="md:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <p className="text-sm font-bold text-gray-700 mb-4">Revenue Harian (Pesanan Selesai)</p>
            {dailyData.length <= 1 ? (
              <div className="h-32 flex items-center justify-center text-gray-300 text-sm">Perluas rentang tanggal untuk melihat grafik</div>
            ) : (
              <MiniBarChart data={dailyData} />
            )}
          </div>
          {/* donut */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <p className="text-sm font-bold text-gray-700 mb-4">Komposisi Pesanan</p>
            <DonutChart slices={donutSlices} />
          </div>
        </div>

        {/* Order table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <p className="text-sm font-bold text-gray-700">Riwayat Pesanan</p>
          </div>
          <Tabs
            className="px-4"
            size="small"
            items={[
              {
                key: "all",
                label: "Semua",
                children: <Table dataSource={orders} columns={columns} rowKey="id" size="small" scroll={{ x: 600 }} pagination={{ pageSize: 20 }} />,
              },
              {
                key: "completed",
                label: "Selesai",
                children: <Table dataSource={completed} columns={columns} rowKey="id" size="small" scroll={{ x: 600 }} pagination={{ pageSize: 20 }} />,
              },
              {
                key: "cancelled",
                label: "Dibatalkan / Void",
                children: <Table dataSource={cancelled} columns={columns} rowKey="id" size="small" scroll={{ x: 600 }} pagination={{ pageSize: 20 }} />,
              },
            ]}
          />
        </div>

      </div>

      {/* ── Order Detail Modal ── */}
      <Modal
        open={!!selectedOrder}
        onCancel={() => setSelectedOrder(null)}
        footer={null}
        title={selectedOrder ? `Detail Pesanan #${selectedOrder.queue_number}` : ""}
        width={520}
      >
        {detailLoading ? (
          <div className="flex justify-center py-8"><Spin size="large" /></div>
        ) : selectedOrder ? (
          <div className="space-y-4">
            {/* Meta row */}
            <div className="flex flex-wrap gap-2">
              <Tag color={ORDER_STATUS_COLOR[selectedOrder.order_status]}>{selectedOrder.order_status.toUpperCase()}</Tag>
              <Tag color={selectedOrder.order_type === "takeaway" ? "orange" : "teal"}>{selectedOrder.order_type === "takeaway" ? "Takeaway" : "Dine-in"}</Tag>
              {selectedOrder.table_number && <Tag>🪑 Meja {selectedOrder.table_number}</Tag>}
              <span className="text-xs text-gray-400 ml-auto">{dayjs(selectedOrder.created_at).format("DD MMM YYYY, HH:mm")}</span>
            </div>

            {/* Items */}
            <div className="rounded-xl border divide-y overflow-hidden">
              {selectedOrder.items && selectedOrder.items.length > 0 ? selectedOrder.items.map((item, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm">{item.product_name_snapshot}</p>
                      {item.selected_variants?.map((v, vi) => (
                        <p key={vi} className="text-xs text-gray-400">↳ {v.group}: {v.option}</p>
                      ))}
                      {item.notes && (
                        <p className="text-xs text-amber-600 mt-0.5">📝 {item.notes}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-xs text-gray-400">×{item.quantity}</p>
                      <p className="text-sm font-bold" style={{ color: "var(--tenant-primary)" }}>
                        {fmt(item.unit_price * item.quantity)}
                      </p>
                    </div>
                  </div>
                </div>
              )) : (
                <p className="px-4 py-3 text-sm text-gray-400">Tidak ada detail item tersedia</p>
              )}
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span>{fmt(selectedOrder.subtotal ?? 0)}</span>
              </div>
              {(selectedOrder.tax_amount ?? 0) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Pajak</span><span>{fmt(selectedOrder.tax_amount ?? 0)}</span>
                </div>
              )}
              {(selectedOrder.service_charge_amount ?? 0) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Service Charge</span><span>{fmt(selectedOrder.service_charge_amount ?? 0)}</span>
                </div>
              )}
              {(selectedOrder.takeaway_fee_amount ?? 0) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Takeaway Fee</span><span>{fmt(selectedOrder.takeaway_fee_amount ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1.5 border-t">
                <span>Total</span>
                <span style={{ color: "var(--tenant-primary)" }}>{fmt(selectedOrder.total_amount ?? 0)}</span>
              </div>
            </div>

            {selectedOrder.customer_notes && (
              <div className="bg-purple-50 rounded-xl px-4 py-3 text-sm text-purple-700">
                🗒️ {selectedOrder.customer_notes}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
