"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getOrdersByTenant, getOrderById, updateOrderStatus } from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import type { Order, OrderItem, Tenant } from "@/types";

type ViewMode = "order" | "menu";

function getItemKey(orderId: string, item: OrderItem, index: number): string {
  return item.id ? `${orderId}_${item.id}` : `${orderId}_idx_${index}`;
}

export default function KitchenPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("order");
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [undoQueueState, setUndoQueueState] = useState<Record<string, boolean>>({});
  const undoQueueRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    async function init() {
      const { tenant_slug } = await params;
      const t = await getTenantBySlug(tenant_slug);
      if (!t) return;
      setTenant(t);
      const data = await getOrdersByTenant(t.id, ["cooking"]);
      setOrders(data);
    }
    init();
  }, [params]);

  useRealtimeOrders(
    tenant?.id ?? "",
    async (newOrder) => {
      if (!shouldShowInKitchen(newOrder, tenant)) return;
      const full = await getOrderById(newOrder.id);
      if (full) setOrders((prev) => [full, ...prev.filter((o) => o.id !== full.id)]);
    },
    async (updated) => {
      if (updated.order_status === "cooking" && shouldShowInKitchen(updated, tenant)) {
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
    (order) => (shouldShowInKitchen(order, tenant) ? "new" : false),
    (order) => (order.order_status === "cooking" && shouldShowInKitchen(order, tenant) ? "new" : false)
  );

  const undoMark = useCallback((orderId: string) => {
    const timer = undoQueueRef.current[orderId];
    if (timer) {
      clearTimeout(timer);
      delete undoQueueRef.current[orderId];
      setUndoQueueState((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? ({ ...o, _marking: false } as Order) : o))
    );
  }, []);

  const markDone = useCallback((orderId: string) => {
    if (undoQueueRef.current[orderId]) {
      clearTimeout(undoQueueRef.current[orderId]);
      delete undoQueueRef.current[orderId];
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? ({ ...o, _marking: true } as Order) : o))
    );

    setUndoQueueState((prev) => ({ ...prev, [orderId]: true }));

    const timeout = setTimeout(async () => {
      if (!undoQueueRef.current[orderId]) return;
      delete undoQueueRef.current[orderId];
      setUndoQueueState((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });

      await updateOrderStatus(orderId, "ready");
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    }, 5000);

    undoQueueRef.current[orderId] = timeout;
  }, []);

  const toggleItemComplete = useCallback(
    (order: Order, itemKey: string) => {
      setCompletedItems((prev) => {
        const next = new Set(prev);
        const wasDone = next.has(itemKey);
        if (wasDone) {
          next.delete(itemKey);
          undoMark(order.id);
        } else {
          next.add(itemKey);
          if (
            order.items &&
            order.items.length > 0 &&
            order.items.every((it, idx) => {
              const k = getItemKey(order.id, it, idx);
              return k === itemKey || next.has(k);
            })
          ) {
            markDone(order.id);
          }
        }
        return next;
      });
    },
    [undoMark, markDone]
  );

  const completeAllItemsInOrder = useCallback(
    (order: Order) => {
      if (!order.items) return;
      setCompletedItems((prev) => {
        const next = new Set(prev);
        order.items!.forEach((it, idx) => {
          next.add(getItemKey(order.id, it, idx));
        });
        return next;
      });
      markDone(order.id);
    },
    [markDone]
  );

  // Grouping for Mode Menu (Batch Cooking)
  const menuGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        productName: string;
        totalQuantity: number;
        completedQuantity: number;
        items: {
          order: Order;
          item: OrderItem;
          itemIndex: number;
          itemKey: string;
          isCompleted: boolean;
        }[];
      }
    >();

    orders.forEach((order) => {
      order.items?.forEach((item, index) => {
        const key = item.product_name_snapshot || "Menu Lain";
        const itemKey = getItemKey(order.id, item, index);
        const isDone = completedItems.has(itemKey);

        if (!map.has(key)) {
          map.set(key, {
            productName: key,
            totalQuantity: 0,
            completedQuantity: 0,
            items: [],
          });
        }

        const group = map.get(key)!;
        group.totalQuantity += item.quantity;
        if (isDone) group.completedQuantity += item.quantity;
        group.items.push({
          order,
          item,
          itemIndex: index,
          itemKey,
          isCompleted: isDone,
        });
      });
    });

    return Array.from(map.values());
  }, [orders, completedItems]);

  const completeBatchMenu = useCallback(
    (groupItems: { order: Order; itemKey: string }[]) => {
      setCompletedItems((prev) => {
        const next = new Set(prev);
        groupItems.forEach(({ itemKey }) => next.add(itemKey));

        const checkedOrders = new Set<string>();
        groupItems.forEach(({ order }) => {
          if (checkedOrders.has(order.id)) return;
          checkedOrders.add(order.id);

          if (
            order.items &&
            order.items.length > 0 &&
            order.items.every((it, idx) => next.has(getItemKey(order.id, it, idx)))
          ) {
            markDone(order.id);
          }
        });

        return next;
      });
    },
    [markDone]
  );

  if (!tenant) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-dark-bg, #0f172a)",
        color: "#f1f5f9",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Header */}
      <header
        className="px-4 sm:px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4"
        style={{ borderColor: "var(--color-dark-border, #334155)", background: "#1e293b" }}
      >
        <div>
          <h1 className="font-bold text-xl leading-none text-white">{tenant.name}</h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "#94a3b8" }}>
            Layar Dapur — <span className="font-bold text-white">{orders.length}</span> pesanan aktif
          </p>
        </div>

        {/* View Mode Toggle Switch */}
        <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700">
          <button
            onClick={() => setViewMode("order")}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === "order"
                ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <span>📋</span> Mode Pesanan ({orders.length})
          </button>
          <button
            onClick={() => setViewMode("menu")}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === "menu"
                ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <span>🍳</span> Mode Menu Batch ({menuGroups.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 hidden sm:inline">Realtime</span>
          <div
            className="w-3 h-3 rounded-full animate-pulse bg-emerald-500"
            title="Realtime aktif"
          />
        </div>
      </header>

      {/* Main Content */}
      <div className="p-4 sm:p-6">

        {/* MODE 1: PER PESANAN (CARD PER ORDER) */}
        {viewMode === "order" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence>
              {orders.map((order) => {
                const isMarking = undoQueueState[order.id] !== undefined;
                const totalItemCount = order.items?.length ?? 0;
                const completedItemCount =
                  order.items?.filter((it, idx) =>
                    completedItems.has(getItemKey(order.id, it, idx))
                  ).length ?? 0;

                return (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
                    className="kitchen-card p-4 flex flex-col justify-between gap-3 rounded-2xl border bg-slate-800/90 border-slate-700 shadow-lg"
                  >
                    <div className="space-y-3">
                      {/* Card Header */}
                      <div className="flex items-start justify-between border-b border-slate-700/80 pb-3">
                        <div>
                          <span
                            className="text-3xl font-black leading-none"
                            style={{ color: "var(--tenant-primary, #6366f1)" }}
                          >
                            #{order.queue_number}
                          </span>
                          {order.table_number && (
                            <p
                              className="mt-1.5 text-xs font-bold px-2 py-0.5 rounded w-fit border"
                              style={{
                                background: "rgba(59, 130, 246, 0.15)",
                                color: "#60a5fa",
                                borderColor: "rgba(59, 130, 246, 0.3)",
                              }}
                            >
                              🪑 Meja {order.table_number}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="text-xs px-2.5 py-1 rounded-full font-semibold"
                            style={{ background: "#1e3a5f", color: "#93c5fd" }}
                          >
                            {order.order_type === "dine_in" ? "Dine-in" : "Takeaway"}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold">
                            {completedItemCount}/{totalItemCount} Selesai
                          </span>
                        </div>
                      </div>

                      {/* Items List with Checklist */}
                      <div className="space-y-2">
                        {order.items && order.items.length > 0 ? (
                          order.items.map((item, i) => {
                            const itemKey = getItemKey(order.id, item, i);
                            const isItemChecked = completedItems.has(itemKey);

                            return (
                              <div
                                key={i}
                                onClick={() => toggleItemComplete(order, itemKey)}
                                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                                  isItemChecked
                                    ? "bg-emerald-950/40 border-emerald-700/50 text-slate-400"
                                    : "bg-slate-700/40 border-slate-600/60 text-slate-100 hover:bg-slate-700/70"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isItemChecked}
                                  onChange={() => {}} // handled by parent onClick
                                  className="mt-0.5 w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 bg-slate-800 border-slate-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`font-semibold text-sm leading-snug ${
                                      isItemChecked ? "line-through text-emerald-400/80" : ""
                                    }`}
                                  >
                                    <span className="font-bold text-indigo-400 mr-1">
                                      {item.quantity}×
                                    </span>
                                    {item.product_name_snapshot}
                                  </p>
                                  {item.selected_variants?.map((v, vi) => (
                                    <p key={vi} className="text-xs text-slate-400">
                                      ↳ {v.group}: {v.option}
                                    </p>
                                  ))}
                                  {item.notes && (
                                    <p
                                      className="text-xs mt-1 px-2 py-0.5 rounded w-fit"
                                      style={{ background: "#451a03", color: "#fbbf24" }}
                                    >
                                      📝 {item.notes}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-slate-400">Memuat detail pesanan...</p>
                        )}
                      </div>

                      {/* Customer Notes */}
                      {order.customer_notes &&
                        order.customer_notes.replace(/\[SERVED\]/g, "").trim() && (
                          <p
                            className="text-xs px-2.5 py-1.5 rounded-xl border border-indigo-900/50"
                            style={{ background: "#1e1b4b", color: "#a5b4fc" }}
                          >
                            🗒️ {order.customer_notes.replace(/\[SERVED\]/g, "").trim()}
                          </p>
                        )}

                      <p className="text-[11px] text-slate-500">
                        Masuk:{" "}
                        {new Date(order.created_at).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="pt-2 border-t border-slate-700/80 space-y-2">
                      {isMarking ? (
                        <UndoButton onUndo={() => undoMark(order.id)} />
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => completeAllItemsInOrder(order)}
                            className="flex-1 py-2.5 px-3 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white transition-all active:scale-95 flex items-center justify-center gap-1 shadow-md"
                          >
                            <span>✅</span> Selesai Semua
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {orders.length === 0 && (
              <div className="col-span-full text-center py-20 text-slate-500">
                <p className="text-5xl mb-4">🍳</p>
                <p className="text-lg font-medium">Tidak ada pesanan aktif saat ini</p>
              </div>
            )}
          </div>
        )}

        {/* MODE 2: PER MENU (BATCH COOKING GROUPING) */}
        {viewMode === "menu" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {menuGroups.map((group) => {
                const isAllBatchDone = group.completedQuantity === group.totalQuantity;

                return (
                  <motion.div
                    key={group.productName}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 shadow-lg transition-all ${
                      isAllBatchDone
                        ? "bg-emerald-950/30 border-emerald-800/60"
                        : "bg-slate-800/90 border-slate-700"
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Menu Header */}
                      <div className="flex items-start justify-between border-b border-slate-700/80 pb-3">
                        <div>
                          <h3 className="font-extrabold text-lg text-white leading-tight">
                            {group.productName}
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {group.items.length} pesanan membutuhkan menu ini
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-2xl font-black text-amber-400">
                            {group.totalQuantity}×
                          </span>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {group.completedQuantity}/{group.totalQuantity} Selesai
                          </p>
                        </div>
                      </div>

                      {/* List of orders ordering this menu item */}
                      <div className="space-y-2">
                        {group.items.map(({ order, item, itemKey, isCompleted }) => (
                          <div
                            key={itemKey}
                            onClick={() => toggleItemComplete(order, itemKey)}
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                              isCompleted
                                ? "bg-emerald-950/50 border-emerald-700/60 text-slate-400"
                                : "bg-slate-700/40 border-slate-600 text-slate-100 hover:bg-slate-700/70"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => {}} // handled by parent onClick
                              className="mt-1 w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 bg-slate-800 border-slate-500 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-extrabold text-sm text-indigo-400">
                                  #{order.queue_number}
                                </span>
                                {order.table_number && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                    🪑 Meja {order.table_number}
                                  </span>
                                )}
                                <span className="text-xs font-bold text-white bg-slate-900/60 px-2 py-0.5 rounded ml-auto">
                                  {item.quantity}×
                                </span>
                              </div>

                              {item.selected_variants?.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {item.selected_variants.map((v, vi) => (
                                    <p key={vi} className="text-xs text-slate-400">
                                      ↳ {v.group}: {v.option}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {item.notes && (
                                <p
                                  className="text-xs mt-1 px-2 py-0.5 rounded w-fit"
                                  style={{ background: "#451a03", color: "#fbbf24" }}
                                >
                                  📝 {item.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action button for Batch Cooking */}
                    <div className="pt-2 border-t border-slate-700/80">
                      <button
                        onClick={() => completeBatchMenu(group.items)}
                        disabled={isAllBatchDone}
                        className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                          isAllBatchDone
                            ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800/60 cursor-default"
                            : "bg-amber-600 hover:bg-amber-500 text-white shadow-md"
                        }`}
                      >
                        {isAllBatchDone ? (
                          <>
                            <span>✅</span> Batch Menu Selesai Dimasak
                          </>
                        ) : (
                          <>
                            <span>🍳</span> Tandai Selesai Semua Batch ({group.totalQuantity}×)
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {menuGroups.length === 0 && (
              <div className="col-span-full text-center py-20 text-slate-500">
                <p className="text-5xl mb-4">🍽️</p>
                <p className="text-lg font-medium">Tidak ada menu yang perlu dimasak</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function UndoButton({ onUndo }: { onUndo: () => void }) {
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  return (
    <div className="space-y-2">
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "#334155" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: "#22c55e" }}
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 5, ease: "linear" }}
        />
      </div>
      <button
        onClick={onUndo}
        className="w-full py-2 rounded-xl font-bold text-xs border bg-slate-700/60 border-slate-600 text-amber-300 hover:bg-slate-700 transition-colors"
      >
        ↩️ Urungkan ({remaining}s)
      </button>
    </div>
  );
}

function shouldShowInKitchen(order: Order, tenant: Tenant | null): boolean {
  if (!tenant) return false;
  const bl = tenant.business_logic;
  if (bl.payment_timing === "prepaid") {
    return order.payment_status === "paid";
  }
  if (bl.require_cashier_verification) {
    return order.verification_status === "verified";
  }
  return order.order_status === "cooking";
}
