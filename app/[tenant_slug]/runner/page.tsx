"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getOrdersByTenant,
  getOrderById,
  updateOrderStatus,
  markOrderServed,
  parseCustomerNotes,
  buildCustomerNotes
} from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import { supabase } from "@/lib/supabase";
import type { Order, Tenant, OrderItem } from "@/types";

type LayoutMode = "board" | "tab";

export default function RunnerPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("board");
  const [activeTab, setActiveTab] = useState<"cooking" | "ready" | "completed">("ready");

  // Track action loading state per order
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  // Track temporary undo queue for recently served orders (5-second grace period)
  const [undoQueue, setUndoQueue] = useState<Record<string, boolean>>({});
  const undoTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const refreshOrders = useCallback(async (tenantId: string) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    const [activeOrders, todayDoneOrders] = await Promise.all([
      getOrdersByTenant(tenantId, ["cooking", "ready"], startOfYesterday.toISOString()),
      getOrdersByTenant(tenantId, ["completed"], startOfToday.toISOString(), endOfToday.toISOString()),
    ]);

    const data = [...activeOrders, ...todayDoneOrders].filter(
      (o, i, arr) => arr.findIndex((x) => x.id === o.id) === i
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setOrders(data);
  }, []);

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const t = await getTenantBySlug(tenant_slug);
      if (!t) return;
      setTenant(t);
      await refreshOrders(t.id);
    }
    init();
  }, [params, refreshOrders]);

  // Realtime subscription
  useRealtimeOrders(
    tenant?.id ?? "",
    async (newOrder) => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      if (new Date(newOrder.created_at) < startOfToday) return;

      if (["cooking", "ready", "completed"].includes(newOrder.order_status)) {
        const full = await getOrderById(newOrder.id);
        if (full) {
          setOrders((prev) => [full, ...prev.filter((o) => o.id !== full.id)]);
        }
      }
    },
    async (updated) => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      if (new Date(updated.created_at) < startOfToday) return;

      if (["cooking", "ready", "completed"].includes(updated.order_status)) {
        const full = await getOrderById(updated.id);
        if (full) {
          setOrders((prev) =>
            prev.find((o) => o.id === full.id)
              ? prev.map((o) => (o.id === full.id ? full : o))
              : [full, ...prev]
          );
        }
      } else {
        setOrders((prev) => prev.filter((o) => o.id !== updated.id));
      }
    },
    () => false, // no beep on insert
    (order) => order.order_status === "ready" ? "ready" : false // beep Ding Dong on ready
  );

  // Group orders by columns
  const cookingOrders = useMemo(() => {
    return orders.filter((o) => o.order_status === "cooking");
  }, [orders]);

  const readyOrders = useMemo(() => {
    return orders.filter(
      (o) => o.order_status === "ready" && !o.customer_notes?.includes("[SERVED]")
    );
  }, [orders]);

  const completedOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        o.payment_status === "paid" &&
        (o.order_status === "completed" || (o.order_status === "ready" && o.customer_notes?.includes("[SERVED]")))
    );
  }, [orders]);

  // Auto-switch layout mode based on window size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setLayoutMode("tab");
      } else {
        setLayoutMode("board");
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleServeClick = useCallback(async (order: Order) => {
    // Unpaid takeaway orders cannot be completed by runner directly
    if (order.order_type === "takeaway" && order.payment_status !== "paid") {
      alert("⚠️ Pesanan Takeaway ini belum lunas! Pelanggan wajib melakukan pembayaran di Kasir terlebih dahulu.");
      return;
    }

    setLoadingStates((prev) => ({ ...prev, [order.id]: true }));
    setUndoQueue((prev) => ({ ...prev, [order.id]: true }));

    const timer = setTimeout(async () => {
      try {
        if (order.order_type === "dine_in") {
          await markOrderServed(order.id, order.customer_notes);
          if (order.payment_status === "paid") {
            await updateOrderStatus(order.id, "completed");
          }
        } else {
          if (order.payment_status === "paid") {
            await updateOrderStatus(order.id, "completed");
          }
        }

        setUndoQueue((prev) => {
          const next = { ...prev };
          delete next[order.id];
          return next;
        });
        delete undoTimers.current[order.id];

        if (tenant) await refreshOrders(tenant.id);
      } catch (err) {
        console.error("Failed to serve order:", err);
      } finally {
        setLoadingStates((prev) => ({ ...prev, [order.id]: false }));
      }
    }, 5000);

    undoTimers.current[order.id] = timer;
  }, [tenant, refreshOrders]);

  const handleUndoServe = useCallback(async (order: Order) => {
    // If it's in the temporary 5s countdown, just clear the timeout
    if (undoTimers.current[order.id]) {
      clearTimeout(undoTimers.current[order.id]);
      delete undoTimers.current[order.id];
      setUndoQueue((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      setLoadingStates((prev) => ({ ...prev, [order.id]: false }));
      return;
    }

    // Otherwise, reverse the database entries
    setLoadingStates((prev) => ({ ...prev, [order.id]: true }));
    try {
      const { cleanNotes, cookedItemIds } = parseCustomerNotes(order.customer_notes);
      const newNotes = buildCustomerNotes(cleanNotes, false, cookedItemIds);

      // Update notes to remove [SERVED]
      await supabase
        .from("orders")
        .update({ customer_notes: newNotes || null })
        .eq("id", order.id);

      // Revert status to ready if it was completed
      if (order.order_status === "completed") {
        await updateOrderStatus(order.id, "ready");
      }

      if (tenant) await refreshOrders(tenant.id);
    } catch (err) {
      console.error("Failed to undo serve:", err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, [order.id]: false }));
    }
  }, [tenant, refreshOrders]);

  if (!tenant) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-dark-bg, #0f172a)",
        color: "#f1f5f9",
        fontFamily: "Inter, sans-serif",
      }}
      className="flex flex-col"
    >
      {/* Header */}
      <header
        className="px-4 sm:px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50 shadow-md"
        style={{ borderColor: "var(--color-dark-border, #334155)", background: "#1e293b" }}
      >
        <div>
          <h1 className="font-extrabold text-xl leading-none text-white tracking-wide">
            {tenant.name}
          </h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "#94a3b8" }}>
            Layar Pelayan &amp; Runner — <span className="font-bold text-emerald-400">{readyOrders.length}</span> siap diantar
          </p>
        </div>

        {/* Tab / Board Controls */}
        <div className="flex items-center gap-3">
          {layoutMode === "tab" && (
            <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700">
              <button
                onClick={() => setActiveTab("cooking")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "cooking"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                Dimasak ({cookingOrders.length})
              </button>
              <button
                onClick={() => setActiveTab("ready")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative ${activeTab === "ready"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                Siap ({readyOrders.length})
                {readyOrders.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-black animate-pulse">
                    {readyOrders.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("completed")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "completed"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                  }`}
              >
                Selesai ({completedOrders.length})
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 hidden sm:inline">Realtime</span>
            <div
              className="w-2.5 h-2.5 rounded-full animate-pulse bg-emerald-500"
              title="Realtime sinkron"
            />
          </div>
        </div>
      </header>

      {/* Main Board View */}
      <main className="flex-1 p-4 sm:p-6 overflow-hidden">
        {layoutMode === "board" ? (
          /* Kanban Board Layout (Desktop) */
          <div className="grid grid-cols-3 gap-6 h-full items-start">
            {/* Column 1: Cooking */}
            <BoardColumn
              title="🍳 Sedang Dimasak"
              subtitle={`${cookingOrders.length} pesanan sedang diproses`}
              bgColor="bg-slate-900/50"
              borderColor="border-slate-800"
            >
              <OrderList
                orders={cookingOrders}
                type="cooking"
                loadingStates={loadingStates}
                undoQueue={undoQueue}
                onServe={handleServeClick}
                onUndo={handleUndoServe}
              />
            </BoardColumn>

            {/* Column 2: Ready */}
            <BoardColumn
              title="🚀 Siap Diantar"
              subtitle={`${readyOrders.length} pesanan siap saji`}
              bgColor="bg-slate-900/70"
              borderColor="border-indigo-950/40"
              highlight
            >
              <OrderList
                orders={readyOrders}
                type="ready"
                loadingStates={loadingStates}
                undoQueue={undoQueue}
                onServe={handleServeClick}
                onUndo={handleUndoServe}
              />
            </BoardColumn>

            {/* Column 3: Completed */}
            <BoardColumn
              title="✅ Selesai Hari Ini"
              subtitle={`${completedOrders.length} diserahkan`}
              bgColor="bg-slate-900/40"
              borderColor="border-slate-850"
            >
              <OrderList
                orders={completedOrders}
                type="completed"
                loadingStates={loadingStates}
                undoQueue={undoQueue}
                onServe={handleServeClick}
                onUndo={handleUndoServe}
              />
            </BoardColumn>
          </div>
        ) : (
          /* Tabbed Layout (Mobile/Tablet) */
          <div className="h-full">
            <AnimatePresence mode="wait">
              {activeTab === "cooking" && (
                <motion.div
                  key="cooking-tab"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <OrderList
                    orders={cookingOrders}
                    type="cooking"
                    loadingStates={loadingStates}
                    undoQueue={undoQueue}
                    onServe={handleServeClick}
                    onUndo={handleUndoServe}
                  />
                </motion.div>
              )}

              {activeTab === "ready" && (
                <motion.div
                  key="ready-tab"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <OrderList
                    orders={readyOrders}
                    type="ready"
                    loadingStates={loadingStates}
                    undoQueue={undoQueue}
                    onServe={handleServeClick}
                    onUndo={handleUndoServe}
                  />
                </motion.div>
              )}

              {activeTab === "completed" && (
                <motion.div
                  key="completed-tab"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <OrderList
                    orders={completedOrders}
                    type="completed"
                    loadingStates={loadingStates}
                    undoQueue={undoQueue}
                    onServe={handleServeClick}
                    onUndo={handleUndoServe}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}

/* Kanban Board Column Wrapper */
interface BoardColumnProps {
  title: string;
  subtitle: string;
  bgColor: string;
  borderColor: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function BoardColumn({ title, subtitle, bgColor, borderColor, highlight, children }: BoardColumnProps) {
  return (
    <div
      className={`flex flex-col h-[calc(100vh-140px)] rounded-2xl border p-4 shadow-lg ${bgColor} ${borderColor} ${highlight ? "ring-2 ring-indigo-500/20" : ""
        }`}
    >
      <div className="border-b border-slate-800 pb-3 mb-4 flex-shrink-0">
        <h2 className="font-extrabold text-base text-white flex items-center gap-2">
          {title}
        </h2>
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        {children}
      </div>
    </div>
  );
}

/* List Component for orders */
interface OrderListProps {
  orders: Order[];
  type: "cooking" | "ready" | "completed";
  loadingStates: Record<string, boolean>;
  undoQueue: Record<string, boolean>;
  onServe: (order: Order) => void;
  onUndo: (order: Order) => void;
}

function OrderList({ orders, type, loadingStates, undoQueue, onServe, onUndo }: OrderListProps) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
        <p className="text-4xl mb-3">
          {type === "cooking" ? "🍳" : type === "ready" ? "🏃‍♂️" : "🎉"}
        </p>
        <p className="text-sm font-medium">Tidak ada pesanan</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            type={type}
            loading={loadingStates[order.id]}
            isUndoing={undoQueue[order.id]}
            onServe={onServe}
            onUndo={onUndo}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/* Single Order Card */
interface OrderCardProps {
  order: Order;
  type: "cooking" | "ready" | "completed";
  loading?: boolean;
  isUndoing?: boolean;
  onServe: (order: Order) => void;
  onUndo: (order: Order) => void;
}

function OrderCard({ order, type, loading, isUndoing, onServe, onUndo }: OrderCardProps) {
  const { cleanNotes, isServed, cookedItemIds, customerName } = parseCustomerNotes(order.customer_notes, order.customer_name);

  const totalItems = order.items?.length ?? 0;
  const cookedCount = order.items?.filter((it) => it.id && cookedItemIds.includes(it.id)).length ?? 0;

  // Calculate elapsed time in minutes
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    const calculateElapsed = () => {
      const minutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
      if (minutes < 1) setElapsed("Baru saja");
      else setElapsed(`${minutes} menit lalu`);
    };
    calculateElapsed();
    const interval = setInterval(calculateElapsed, 30000);
    return () => clearInterval(interval);
  }, [order.created_at]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      className={`p-4 rounded-xl border flex flex-col justify-between gap-4 shadow-md transition-all ${isUndoing
          ? "border-emerald-700 bg-emerald-950/20"
          : type === "ready"
            ? "border-slate-700 bg-slate-800 hover:border-indigo-500/40"
            : type === "completed"
              ? "border-slate-800 bg-slate-900/70 opacity-80"
              : "border-slate-800 bg-slate-850"
        }`}
    >
      <div>
        {/* Header: Queue Number and Tags */}
        <div className="flex items-start justify-between border-b border-slate-700/60 pb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-2xl font-black leading-none"
                style={{ color: "#38bdf8" }}
              >
                #{order.queue_number}
              </span>
              {customerName && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  👤 {customerName}
                </span>
              )}
            </div>
            {order.table_number ? (
              <span className="inline-block mt-1.5 text-xs font-bold px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400">
                🪑 Meja {order.table_number}
              </span>
            ) : (
              <span className="inline-block mt-1.5 text-xs font-bold px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
                🥡 Takeaway
              </span>
            )}
          </div>
          <div className="text-right">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide uppercase ${order.payment_status === "paid"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                }`}
            >
              {order.payment_status === "paid" ? "LUNAS" : "UNPAID"}
            </span>
            <p className="text-[10px] text-slate-400 font-medium mt-1">
              {cookedCount}/{totalItems} Siap
            </p>
          </div>
        </div>

        {/* Itemized List */}
        <div className="mt-3 space-y-2">
          {order.items?.map((item) => {
            const isItemCooked = item.id && cookedItemIds.includes(item.id);
            return (
              <div
                key={item.id}
                className={`flex items-start gap-2.5 p-2 rounded-lg border transition-all ${isItemCooked
                    ? "bg-emerald-950/20 border-emerald-950/60 text-slate-350"
                    : "bg-slate-900/35 border-slate-800/80 text-slate-100"
                  }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {isItemCooked ? (
                    <span className="text-emerald-500 text-sm">✅</span>
                  ) : (
                    <span className="inline-block w-4 h-4 rounded-full border border-slate-650 bg-slate-800 relative">
                      {type === "cooking" && (
                        <span className="absolute inset-0.5 rounded-full bg-amber-500 animate-pulse" />
                      )}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-xs leading-normal ${isItemCooked ? "line-through text-slate-400" : ""}`}>
                    <span className="text-indigo-400 font-bold mr-1">{item.quantity}×</span>
                    {item.product_name_snapshot}
                  </p>
                  {item.selected_variants?.map((v, vi) => (
                    <p key={vi} className="text-[10px] text-slate-400 mt-0.5">
                      ↳ {v.group}: {v.option}
                    </p>
                  ))}
                  {item.notes && (
                    <span className="inline-block text-[10px] mt-1 px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/40 font-medium">
                      📝 {item.notes}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Customer Notes */}
        {cleanNotes && (
          <div className="mt-3 p-2 rounded-lg border border-slate-800 bg-slate-900/50 text-xs text-slate-300">
            <span className="font-semibold text-slate-400">Catatan:</span> {cleanNotes}
          </div>
        )}

        {/* Footer info: elapsed time */}
        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
          <span>{new Date(order.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="font-medium">{elapsed}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="border-t border-slate-700/50 pt-3 mt-1">
        {isUndoing ? (
          <UndoTimer onUndo={() => onUndo(order)} />
        ) : (
          <div className="flex gap-2">
            {type === "ready" && (
              <button
                onClick={() => onServe(order)}
                disabled={loading}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-md flex items-center justify-center gap-1.5 ${order.order_type === "dine_in"
                    ? "bg-amber-600 hover:bg-amber-500 text-white"
                    : order.payment_status === "paid"
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-slate-700 text-rose-300 border border-rose-500/40"
                  }`}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : order.order_type === "dine_in" ? (
                  <>
                    <span>🍽️</span> Selesai Saji (Meja {order.table_number})
                  </>
                ) : order.payment_status === "paid" ? (
                  <>
                    <span>📦</span> Selesai Serah (Takeaway)
                  </>
                ) : (
                  <>
                    <span>⚠️</span> Belum Lunas (Bayar di Kasir)
                  </>
                )}
              </button>
            )}


          </div>
        )}
      </div>
    </motion.div>
  );
}

/* Undo timer component with progress bar */
function UndoTimer({ onUndo }: { onUndo: () => void }) {
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(interval);
  }, [remaining]);

  return (
    <div className="space-y-2">
      <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
        <motion.div
          className="h-full bg-emerald-500"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 5, ease: "linear" }}
        />
      </div>
      <button
        onClick={onUndo}
        className="w-full py-1.5 rounded-xl text-xs font-bold border border-slate-700 bg-slate-850 text-amber-300 hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
      >
        <span>↩️</span> Batalkan Pengantaran ({remaining}s)
      </button>
    </div>
  );
}
