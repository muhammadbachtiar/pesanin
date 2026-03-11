"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getOrdersByTenant, updateOrderStatus } from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import type { Order, Tenant } from "@/types";

export default function KitchenPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [undoQueue, setUndoQueue] = useState<Record<string, ReturnType<typeof setTimeout>>>({});

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
    (newOrder) => {
      if (shouldShowInKitchen(newOrder, tenant)) {
        setOrders((prev) => [newOrder, ...prev]);
      }
    },
    (updated) => {
      if (updated.order_status === "cooking" && shouldShowInKitchen(updated, tenant)) {
        setOrders((prev) =>
          prev.find((o) => o.id === updated.id)
            ? prev.map((o) => (o.id === updated.id ? updated : o))
            : [updated, ...prev]
        );
      } else {
        setOrders((prev) => prev.filter((o) => o.id !== updated.id));
      }
    }
  );

  const markDone = useCallback(
    (orderId: string) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, _marking: true } as Order : o))
      );

      const timeout = setTimeout(async () => {
        await updateOrderStatus(orderId, "ready");
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        setUndoQueue((q) => {
          const next = { ...q };
          delete next[orderId];
          return next;
        });
      }, 5000);

      setUndoQueue((q) => ({ ...q, [orderId]: timeout }));
    },
    []
  );

  const undoMark = useCallback((orderId: string) => {
    const timeout = undoQueue[orderId];
    if (timeout) {
      clearTimeout(timeout);
      setUndoQueue((q) => {
        const next = { ...q };
        delete next[orderId];
        return next;
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, _marking: false } as Order : o))
      );
    }
  }, [undoQueue]);

  if (!tenant) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-dark-bg)",
        color: "#f1f5f9",
      }}
    >
      <header
        className="px-6 py-4 border-b flex items-center justify-between"
        style={{ borderColor: "var(--color-dark-border)" }}
      >
        <div>
          <h1 className="font-bold text-xl">{tenant.name}</h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Layar Dapur — {orders.length} pesanan aktif
          </p>
        </div>
        <div
          className="w-3 h-3 rounded-full animate-pulse"
          style={{ background: "#22c55e" }}
          title="Realtime aktif"
        />
      </header>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {orders.map((order) => {
            const isMarking = undoQueue[order.id] !== undefined;
            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
                className="kitchen-card p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className="text-3xl font-black"
                      style={{ color: "var(--tenant-primary, #6366f1)" }}
                    >
                      #{order.queue_number}
                    </span>
                    {order.table_number && (
                      <p className="text-sm" style={{ color: "#94a3b8" }}>
                        Meja {order.table_number}
                      </p>
                    )}
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full"
                    style={{ background: "#1e3a5f", color: "#93c5fd" }}
                  >
                    {order.order_type === "dine_in" ? "Dine-in" : "Takeaway"}
                  </span>
                </div>

                <div
                  className="border-t pt-3 space-y-2"
                  style={{ borderColor: "var(--color-dark-border)" }}
                >
                  {order.items?.map((item, i) => (
                    <div key={i}>
                      <p className="font-semibold">
                        {item.quantity}× {item.product_name_snapshot}
                      </p>
                      {item.selected_variants.map((v, vi) => (
                        <p key={vi} className="text-xs" style={{ color: "#94a3b8" }}>
                          ↳ {v.group}: {v.option}
                        </p>
                      ))}
                      {item.notes && (
                        <p
                          className="text-xs mt-0.5 px-2 py-0.5 rounded"
                          style={{ background: "#451a03", color: "#fbbf24" }}
                        >
                          📝 {item.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {order.customer_notes && (
                  <p
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: "#1e1b4b", color: "#a5b4fc" }}
                  >
                    🗒️ {order.customer_notes}
                  </p>
                )}

                <p className="text-xs" style={{ color: "#475569" }}>
                  {new Date(order.created_at).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>

                {isMarking ? (
                  <UndoButton onUndo={() => undoMark(order.id)} />
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => markDone(order.id)}
                    className="w-full py-3 rounded-xl font-bold text-white"
                    style={{ background: "#22c55e" }}
                  >
                    ✅ Selesai Dimasak
                  </motion.button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {orders.length === 0 && (
          <div
            className="col-span-full text-center py-20"
            style={{ color: "#475569" }}
          >
            <p className="text-5xl mb-4">🍳</p>
            <p className="text-lg">Tidak ada pesanan aktif</p>
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
        className="h-1 rounded-full overflow-hidden"
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
        className="w-full py-2 rounded-xl font-semibold text-sm border"
        style={{ borderColor: "#475569", color: "#94a3b8" }}
      >
        Urungkan ({remaining}s)
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
