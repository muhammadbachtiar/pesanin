"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { Table, Tag, Button, Modal, Form, Input, Select, Badge, Tabs, Switch, InputNumber, Drawer, Space } from "antd";
import { getOrdersByTenant, getOrderById, markOrderPaid, markOrderServed, approveOrder, voidOrder, updateOrderStatus, createOrder, generateQueueNumber, parseCustomerNotes, buildCustomerNotes, updateOrderCookedItems, getActiveOrderByTable } from "@/services/orderService";
import { getTenantBySlug } from "@/services/tenantService";
import { message } from "antd";
import { getAllProductsByTenant, getCategoriesWithProducts } from "@/services/productService";
import { getCurrentProfile } from "@/services/authService";
import { toggleProductAvailability } from "@/services/productService";
import { useRealtimeOrders } from "@/hooks/useRealtime";
import type { Order, Tenant, Profile, Product, CartItem, PaymentMethodType, Category } from "@/types";
import { ProductCard } from "@/components/ProductCard";

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
  const [payModal, setPayModal] = useState<{ open: boolean; order: Order | null; autoComplete?: boolean }>({ open: false, order: null, autoComplete: false });
  const [payMethod, setPayMethod] = useState<PaymentMethodType>("cash");
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [printOnSubmit, setPrintOnSubmit] = useState<boolean>(true);
  const [printReceiptData, setPrintReceiptData] = useState<{
    order: Order;
    payMethod: PaymentMethodType;
    cashReceived: number | null;
  } | null>(null);
  const [newOrderDrawer, setNewOrderDrawer] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pendingBadge, setPendingBadge] = useState(0);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [posMobileTab, setPosMobileTab] = useState<"menu" | "cart">("menu");
  const [voidForm] = Form.useForm();
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [undoQueueState, setUndoQueueState] = useState<Record<string, string>>({});
  const undoQueueRef = useRef<Record<string, { timer: ReturnType<typeof setTimeout>; previousNotes?: string }>>({});
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const softRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [windowWidth, setWindowWidth] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1200);
  // Pull-to-refresh state
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const pullStartY = useRef(0);
  const PULL_THRESHOLD = 72;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const drawerWidth = windowWidth < 768 ? "100%" : windowWidth < 1280 ? "88%" : "78%";
  const refreshOrders = useCallback(async (tenantId: string) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Retention Cutoff: Max H-1 (Kemarin 00:00:00 / 48 Jam) agar pesanan ghaib lampau tidak mengotori layar
    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    const [activeOrders, todayDoneOrders] = await Promise.all([
      getOrdersByTenant(tenantId, ["pending", "cooking", "ready"], startOfYesterday.toISOString()),
      getOrdersByTenant(tenantId, ["completed", "cancelled"], startOfToday.toISOString(), endOfToday.toISOString()),
    ]);

    const data = [...activeOrders, ...todayDoneOrders].filter(
      (o, i, arr) => arr.findIndex((x) => x.id === o.id) === i
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    for (const o of data) {
      if (o.order_status === "ready" && o.payment_status === "paid") {
        const { isServed } = parseCustomerNotes(o.customer_notes);
        if (isServed) {
          updateOrderStatus(o.id, "completed");
          o.order_status = "completed";
        }
      }
    }

    setOrders(data);
    setLastSynced(new Date());
    setPendingBadge(
      data.filter(
        (o) =>
          o.order_status === "pending" &&
          (o.payment_status === "unpaid" || o.verification_status === "unverified")
      ).length
    );
  }, []);

  const cancelCountdownAction = useCallback(async (orderId: string) => {
    const queueEntry = undoQueueRef.current[orderId];
    if (queueEntry) {
      clearTimeout(queueEntry.timer);
      delete undoQueueRef.current[orderId];
      setUndoQueueState((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });

      if (queueEntry.previousNotes !== undefined) {
        const prevNotes = queueEntry.previousNotes;
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, customer_notes: prevNotes ?? "" } : o))
        );
        try {
          const { cookedItemIds } = parseCustomerNotes(prevNotes ?? "");
          await updateOrderCookedItems(orderId, null, cookedItemIds);
        } catch (err) {
          console.error("Failed to revert DB notes in cashier cancelCountdownAction:", err);
        }
      }

      if (tenant) refreshOrders(tenant.id);
    }
  }, [tenant, refreshOrders]);

  const startCountdownAction = useCallback(
    (orderId: string, actionLabel: string, actionFn: () => Promise<void>, previousNotes?: string | null) => {
      const existing = undoQueueRef.current[orderId];
      if (existing) {
        clearTimeout(existing.timer);
      }
      const savedNotes: string | null | undefined = previousNotes !== undefined ? previousNotes : existing?.previousNotes;

      setUndoQueueState((prev) => ({ ...prev, [orderId]: actionLabel }));

      const timeout = setTimeout(async () => {
        if (!undoQueueRef.current[orderId]) return;
        delete undoQueueRef.current[orderId];
        setUndoQueueState((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });

        await actionFn();
      }, 5000);

      undoQueueRef.current[orderId] = { timer: timeout, previousNotes: savedNotes ?? undefined };
    },
    []
  );



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

  // Auto soft refresh every 60 seconds (background heartbeat)
  useEffect(() => {
    if (!tenant) return;
    const tenantId = tenant.id;
    softRefreshIntervalRef.current = setInterval(async () => {
      await refreshOrders(tenantId);
    }, 60000);
    return () => {
      if (softRefreshIntervalRef.current) clearInterval(softRefreshIntervalRef.current);
    };
  }, [tenant, refreshOrders]);

  const handleManualSync = useCallback(async () => {
    if (!tenant || isSyncing) return;
    setIsSyncing(true);
    try {
      await refreshOrders(tenant.id);
    } finally {
      setIsSyncing(false);
    }
  }, [tenant, refreshOrders, isSyncing]);

  // Pull-to-refresh touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    if (delta > 0) setPullY(Math.min(delta, PULL_THRESHOLD + 20));
  }, [isPulling]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;
    if (pullY >= PULL_THRESHOLD) {
      await handleManualSync();
    }
    setPullY(0);
    setIsPulling(false);
  }, [isPulling, pullY, handleManualSync]);

  useRealtimeOrders(
    tenant?.id ?? "",
    async (newOrder) => {
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
      if (order.order_status === "ready" && order.payment_status === "paid") {
        const { isServed } = parseCustomerNotes(order.customer_notes);
        if (isServed) {
          await updateOrderStatus(order.id, "completed");
          order.order_status = "completed";
        }
      }
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
      setPendingBadge((n) => {
        const wasPending = updated.order_status === "pending";
        const isNowPending = order.order_status === "pending";
        if (!wasPending && isNowPending) return n + 1;
        if (wasPending && !isNowPending) return Math.max(0, n - 1);
        return n;
      });
    },
    () => "new",
    (order) => {
      if (order.order_status === "ready") return "ready";
      if (order.order_status === "cooking" || order.order_status === "pending") return "new";
      return false;
    }
  );

  const handleVoid = async (values: { reason: string }) => {
    if (!profile || submitting["void"]) return;
    setSubmitting((s) => ({ ...s, void: true }));
    try {
      await voidOrder(voidModal.orderId, values.reason, profile.id);
      setVoidModal({ open: false, orderId: "" });
      voidForm.resetFields();
      if (tenant) refreshOrders(tenant.id);
    } finally {
      setSubmitting((s) => ({ ...s, void: false }));
    }
  };

  const handlePayConfirm = async () => {
    if (!profile || !payModal.order || submitting["pay"]) return;
    const rawOrder = payModal.order;
    const fullOrder = orders.find((o) => o.id === rawOrder.id) || rawOrder;

    if (payMethod === "cash" && cashReceived !== null && cashReceived < fullOrder.total_amount) {
      Modal.error({
        title: "Uang Diterima Kurang",
        content: "Nominal uang tunai yang dimasukkan lebih kecil dari total tagihan.",
      });
      return;
    }

    setSubmitting((s) => ({ ...s, pay: true }));
    try {
      const { isServed } = parseCustomerNotes(fullOrder.customer_notes);
      // pos_only mode: always mark completed immediately after payment (no kitchen flow)
      const targetStatus: Order["order_status"] = (isPosOnly || payModal.autoComplete || (isServed && fullOrder.order_status === "ready"))
        ? "completed"
        : fullOrder.order_status === "pending"
          ? "cooking"
          : fullOrder.order_status;

      setPrintReceiptData({
        order: fullOrder,
        payMethod,
        cashReceived,
      });

      setOrders((prev) =>
        prev.map((o) =>
          o.id === fullOrder.id
            ? {
              ...o,
              payment_status: "paid",
              payment_method: payMethod,
              verification_status: "verified",
              order_status: targetStatus,
            }
            : o
        )
      );

      // Close modal cleanly
      setPayModal({ open: false, order: null, autoComplete: false });
      setCashReceived(null);

      // Persist update in DB
      const ok = await markOrderPaid(fullOrder.id, payMethod, profile.id, targetStatus);
      if (!ok) {
        message.error("Gagal mengupdate status pembayaran di database.");
      }

      // Background refresh to keep in full sync
      if (tenant) {
        await refreshOrders(tenant.id);
      }

      // Trigger print thermal receipt
      if (printOnSubmit) {
        handlePrintReceipt();
      }
    } catch (err) {
      console.error("handlePayConfirm error:", err);
      message.error("Terjadi kesalahan saat mengonfirmasi pembayaran.");
    } finally {
      setSubmitting((s) => ({ ...s, pay: false }));
    }
  };

  const handleServe = async (order: Order) => {
    if (submitting[`serve_${order.id}`]) return;
    setSubmitting((s) => ({ ...s, [`serve_${order.id}`]: true }));
    try {
      await markOrderServed(order.id, order.customer_notes);
      if (order.payment_status === "paid") {
        await updateOrderStatus(order.id, "completed");
      }
      if (tenant) refreshOrders(tenant.id);
    } finally {
      setSubmitting((s) => ({ ...s, [`serve_${order.id}`]: false }));
    }
  };

  const handlePrintReceipt = () => {
    setTimeout(() => {
      window.print();
    }, 120);
  };

  const handleApprove = async (orderId: string) => {
    if (!profile || submitting[`approve_${orderId}`]) return;
    setSubmitting((s) => ({ ...s, [`approve_${orderId}`]: true }));
    try {
      await approveOrder(orderId, profile.id);
      if (tenant) refreshOrders(tenant.id);
    } finally {
      setSubmitting((s) => ({ ...s, [`approve_${orderId}`]: false }));
    }
  };

  const handleReadyToComplete = async (orderId: string) => {
    if (submitting[`complete_${orderId}`]) return;
    setSubmitting((s) => ({ ...s, [`complete_${orderId}`]: true }));
    try {
      await updateOrderStatus(orderId, "completed");
      if (tenant) refreshOrders(tenant.id);
    } finally {
      setSubmitting((s) => ({ ...s, [`complete_${orderId}`]: false }));
    }
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

  const updateProductQuantityInCart = (product: Product, newQty: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (newQty <= 0) {
        return prev.filter((c) => c.product.id !== product.id);
      }
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: newQty };
        return next;
      }
      return [...prev, { product, quantity: newQty, selected_variants: [], notes: "", unit_price: product.base_price }];
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

  const handleCreateCashierOrder = async (mode: "pay_now" | "save_pending" = "pay_now") => {
    if (!tenant || !profile || cart.length === 0 || submitting["createOrder"]) return;

    const isTableMode = tenant.business_logic?.numbering === "table" && orderType !== "takeaway";
    const cleanTableNum = tableNumber.trim();

    if (isTableMode) {
      if (!cleanTableNum) {
        message.error("Nomor Meja wajib diisi untuk pesanan Dine-In!");
        return;
      }

      // Check if table is occupied by an active (uncompleted) order
      const activeExisting =
        orders.find(
          (o) =>
            ["pending", "cooking", "ready"].includes(o.order_status) &&
            o.table_number?.trim().toLowerCase() === cleanTableNum.toLowerCase()
        ) || (await getActiveOrderByTable(tenant.id, cleanTableNum));

      if (activeExisting) {
        message.error(
          `Meja "${cleanTableNum}" sedang terisi oleh Pesanan #${activeExisting.queue_number} (${activeExisting.order_status.toUpperCase()}) yang belum selesai!`
        );
        return;
      }
    }

    setSubmitting((s) => ({ ...s, createOrder: true }));
    try {
      const qn = await generateQueueNumber(tenant.id);
      const isPayNow = mode === "pay_now";

      const notesWithCustomerName = buildCustomerNotes(customerNotes, false, [], customerName.trim());
      const created = await createOrder(
        {
          tenant_id: tenant.id,
          queue_number: qn,
          customer_name: customerName.trim() || undefined,
          table_number: isTableMode ? cleanTableNum : undefined,
          order_type: orderType,
          subtotal: cartSubtotal,
          tax_amount: cartTax,
          service_charge_amount: cartSvc,
          takeaway_fee_amount: cartTkwy,
          total_amount: cartTotal,
          customer_notes: notesWithCustomerName || undefined,
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
      setCustomerName("");
      setCustomerNotes("");
      setOrderType("dine_in");
      setNewOrderDrawer(false);

      if (created) {
        if (isPayNow || isPosOnly) {
          // POS mode: skip kitchen, go directly to payment + auto-complete on pay
          await updateOrderStatus(created.id, "cooking");
          setPayModal({ open: true, order: created, autoComplete: isPosOnly });
          setPayMethod("cash");
          setCashReceived(created.total_amount);
          message.success(`Pesanan #${qn} berhasil dikirim!`);
        } else {
          message.success(`Pesanan #${qn} berhasil disimpan di daftar Menunggu`);
        }
      }

      if (tenant) refreshOrders(tenant.id);
    } finally {
      setSubmitting((s) => ({ ...s, createOrder: false }));
    }
  };

  const toggleItemCompleteCashier = useCallback(
    async (order: Order, itemId: string) => {
      if (!itemId) return;
      const { cleanNotes, isServed, cookedItemIds } = parseCustomerNotes(order.customer_notes);
      const isAlreadyCooked = cookedItemIds.includes(itemId);

      let newCookedItemIds: string[];
      if (isAlreadyCooked) {
        newCookedItemIds = cookedItemIds.filter((id) => id !== itemId);
        cancelCountdownAction(order.id);
      } else {
        newCookedItemIds = [...cookedItemIds, itemId];
      }

      const newNotes = buildCustomerNotes(cleanNotes, isServed, newCookedItemIds);
      const previousNotes = order.customer_notes;

      // Optimistic state update in Cashier table
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, customer_notes: newNotes } : o))
      );

      const allCooked =
        order.items &&
        order.items.length > 0 &&
        order.items.every((it) => it.id && newCookedItemIds.includes(it.id));

      if (allCooked && order.order_status === "cooking" && !isAlreadyCooked) {
        startCountdownAction(order.id, "Tandai Siap", async () => {
          await updateOrderStatus(order.id, "ready");
          if (tenant) refreshOrders(tenant.id);
        }, previousNotes);
      }

      try {
        const ok = await updateOrderCookedItems(order.id, previousNotes, newCookedItemIds);
        if (!ok) throw new Error("Gagal menyimpan ke DB");
      } catch (err) {
        console.error("Optimistic cashier update failed:", err);
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, customer_notes: previousNotes } : o))
        );
        cancelCountdownAction(order.id);
      }
    },
    [cancelCountdownAction, startCountdownAction, tenant, refreshOrders]
  );

  const handleMarkOrderReady = useCallback(
    async (order: Order) => {
      const allItemIds = order.items
        ? (order.items.map((it) => it.id).filter(Boolean) as string[])
        : [];
      const { cleanNotes, isServed } = parseCustomerNotes(order.customer_notes);
      const newNotes = buildCustomerNotes(cleanNotes, isServed, allItemIds);
      const previousNotes = order.customer_notes;

      // Optimistically mark all items as cooked in local state
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, customer_notes: newNotes } : o))
      );

      startCountdownAction(order.id, "Tandai Siap", async () => {
        try {
          if (allItemIds.length > 0) {
            await updateOrderCookedItems(order.id, previousNotes, allItemIds);
          }
          await updateOrderStatus(order.id, "ready");
          if (tenant) refreshOrders(tenant.id);
        } catch (err) {
          console.error("Failed to mark order ready in cashier:", err);
          if (tenant) refreshOrders(tenant.id);
        }
      }, previousNotes);
    },
    [startCountdownAction, tenant, refreshOrders]
  );

  // ──────────────────────────── Filtered product list ───────────────────────────────
  const visibleProducts = products.filter((p) => {
    const matchCat = selectedCat ? p.category_id === selectedCat : true;
    const matchQ = p.name.toLowerCase().includes(productSearch.toLowerCase());
    return p.is_available && matchCat && matchQ;
  });

  const bl = tenant?.business_logic;
  const isPosOnly = bl?.pos_only === true;
  // pos_only: always prepaid, hide pending tab since every order is immediately completed
  const showPendingTab = !isPosOnly && (bl?.payment_timing === "postpaid" || bl?.payment_mode === "manual");

  const columns = [
    {
      title: "Antrian / Meja",
      width: 140,
      render: (_: unknown, r: Order) => {
        const { customerName } = parseCustomerNotes(r.customer_notes, r.customer_name);
        return (
          <div className="flex flex-col gap-1">
            <span className="font-black text-2xl leading-none" style={{ color: "var(--tenant-primary)" }}>
              #{r.queue_number}
            </span>
            {customerName && (
              <span className="text-xs font-bold text-gray-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md w-fit flex items-center gap-1">
                👤 {customerName}
              </span>
            )}
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
        );
      },
    },
    {
      title: "Item Pesanan",
      render: (_: unknown, r: Order) => {
        const { cleanNotes, isServed, cookedItemIds } = parseCustomerNotes(r.customer_notes);
        const isCooking = r.order_status === "cooking";
        return (
          <div className="text-sm space-y-1">
            {r.items && r.items.length > 0 ? (
              r.items.map((it, i) => {
                const isCooked = it.id && cookedItemIds.includes(it.id);
                return (
                  <div
                    key={i}
                    onClick={() => isCooking && it.id && toggleItemCompleteCashier(r, it.id)}
                    className={`flex items-center gap-1.5 p-1 rounded-md transition-colors ${isCooking ? "cursor-pointer hover:bg-gray-100" : ""
                      }`}
                    title={isCooking ? "Klik untuk ubah status matang item" : undefined}
                  >
                    <span className="font-bold text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
                      ×{it.quantity}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                      <span className={`font-medium ${isCooked ? "line-through text-gray-400" : ""}`}>
                        {it.product_name_snapshot}
                      </span>
                      {isCooked ? (
                        <span className="text-emerald-600 text-xs font-black" title="Siap">✓</span>
                      ) : (
                        isCooking && (
                          <span className="text-amber-500 text-xs leading-none animate-pulse" title="Sedang dimasak">●</span>
                        )
                      )}
                      {it.notes && (
                        <span className="text-xs text-amber-600 font-medium ml-1">📝 {it.notes}</span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <span className="text-gray-400 text-xs">—</span>
            )}
            {cleanNotes && (
              <div className="mt-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
                🗒️ {cleanNotes}
              </div>
            )}
            {r.order_type === "dine_in" && isServed && (
              <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                🍽️ SUDAH DISAJIKAN
              </span>
            )}
          </div>
        );
      },
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
      title: "Waktu",
      width: 120,
      render: (_: unknown, r: Order) => {
        const orderDate = new Date(r.created_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isYesterday = orderDate < today;
        const timeStr = orderDate.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
        const dateStr = orderDate.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold text-gray-800">{timeStr}</span>
            {isYesterday && (
              <span className="text-[10px] font-extrabold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full w-fit flex items-center gap-0.5">
                🗓️ {dateStr}
              </span>
            )}
          </div>
        );
      },
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
      width: 220,
      render: (_: unknown, r: Order) => {
        const isServed = r.customer_notes?.includes("[SERVED]");
        const isDineIn = r.order_type === "dine_in";
        const isUnpaid = r.payment_status === "unpaid";
        const isPaid = r.payment_status === "paid";
        const pendingActionLabel = undoQueueState[r.id];

        if (pendingActionLabel) {
          return (
            <CashierUndoButton
              label={pendingActionLabel}
              onUndo={() => cancelCountdownAction(r.id)}
            />
          );
        }

        return (
          <div className="flex flex-wrap gap-1.5">
            {/* TAB MENUNGGU (pending) */}
            {r.order_status === "pending" && (
              <>
                {bl?.payment_timing === "postpaid" &&
                  bl.require_cashier_verification &&
                  r.verification_status === "unverified" && (
                    <Button
                      size="small"
                      loading={submitting[`approve_${r.id}`]}
                      style={{ background: "#22c55e", color: "#fff", border: "none" }}
                      onClick={() =>
                        Modal.confirm({
                          title: "Terima pesanan ini? Pesanan akan diteruskan ke dapur",
                          onOk: () => handleApprove(r.id),
                        })
                      }
                    >
                      Terima
                    </Button>
                  )}
                {isUnpaid && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      setPayModal({ open: true, order: r, autoComplete: false });
                      setPayMethod(r.payment_method || "cash");
                      setCashReceived(r.total_amount);
                    }}
                  >
                    Tandai Lunas
                  </Button>
                )}
              </>
            )}

            {/* TAB SEDANG DIMASAK (cooking) */}
            {r.order_status === "cooking" && (
              <>
                <Button
                  size="small"
                  style={{ background: "#3b82f6", color: "#fff", border: "none" }}
                  onClick={() => handleMarkOrderReady(r)}
                >
                  ✅ Tandai Siap
                </Button>
                {isUnpaid && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      setPayModal({ open: true, order: r, autoComplete: false });
                      setPayMethod(r.payment_method || "cash");
                      setCashReceived(r.total_amount);
                    }}
                  >
                    Tandai Lunas
                  </Button>
                )}
              </>
            )}

            {/* TAB SIAP AMBIL / SAJIKAN (ready) */}
            {r.order_status === "ready" && (
              <>
                {/* For Dine-in: step 1 is Sajikan (if not served yet) */}
                {isDineIn && !isServed && (
                  <Button
                    size="small"
                    loading={submitting[`serve_${r.id}`]}
                    style={{ background: "#f59e0b", color: "#fff", border: "none" }}
                    onClick={() =>
                      startCountdownAction(r.id, "Sajikan", async () => {
                        await handleServe(r);
                      })
                    }
                  >
                    🍽️ Sajikan
                  </Button>
                )}

                {/* If Dine-in served OR Takeaway: can now be completed */}
                {(isServed || !isDineIn) && (
                  <>
                    {isPaid ? (
                      <Button
                        size="small"
                        loading={submitting[`complete_${r.id}`]}
                        style={{ background: "#3b82f6", color: "#fff", border: "none" }}
                        onClick={() =>
                          startCountdownAction(r.id, "Selesai", async () => {
                            await handleReadyToComplete(r.id);
                          })
                        }
                      >
                        ✅ Selesai
                      </Button>
                    ) : (
                      /* 1 Button gabungan untuk Tandai Lunas & Selesai */
                      <Button
                        type="primary"
                        size="small"
                        style={{ background: "#10b981", borderColor: "#10b981", color: "#fff" }}
                        onClick={() => {
                          setPayModal({ open: true, order: r, autoComplete: true });
                          setPayMethod(r.payment_method || "cash");
                          setCashReceived(r.total_amount);
                        }}
                      >
                        💳 Tandai Lunas & Selesai
                      </Button>
                    )}
                  </>
                )}

                {/* Secondary Tandai Lunas if unpaid and not served yet */}
                {isDineIn && !isServed && isUnpaid && (
                  <Button
                    type="default"
                    size="small"
                    onClick={() => {
                      setPayModal({ open: true, order: r, autoComplete: false });
                      setPayMethod(r.payment_method || "cash");
                      setCashReceived(r.total_amount);
                    }}
                  >
                    Tandai Lunas
                  </Button>
                )}
              </>
            )}

            {/* VOID BUTTON */}
            {r.order_status !== "cancelled" && !isOrderEffectivelyCompleted(r) && (
              <Button danger size="small" onClick={() => setVoidModal({ open: true, orderId: r.id })}>
                Void
              </Button>
            )}

            {/* REPRINT RECEIPT BUTTON */}
            {(r.payment_status === "paid" || isOrderEffectivelyCompleted(r)) && (
              <Button
                size="small"
                icon={<span>🖨️</span>}
                onClick={() => {
                  setPrintReceiptData({ order: r, payMethod: r.payment_method ?? "cash", cashReceived: null });
                  setTimeout(() => window.print(), 150);
                }}
              >
                Cetak
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const isOrderEffectivelyCompleted = useCallback((o: Order) => {
    if (o.order_status === "completed") return true;
    if (o.order_status === "ready") {
      const { isServed } = parseCustomerNotes(o.customer_notes);
      const isDineIn = o.order_type !== "takeaway";
      const isPaid = o.payment_status === "paid";
      if (isDineIn && isServed && isPaid) {
        return true;
      }
    }
    return false;
  }, []);

  const filterOrders = useCallback(
    (statuses: Order["order_status"][], payStatuses?: Order["payment_status"][]) =>
      orders.filter((o) => {
        if (statuses.includes("completed")) {
          if (o.order_status === "cancelled") return true;
          if (isOrderEffectivelyCompleted(o)) return true;
          return false;
        }
        if (statuses.includes("ready")) {
          if (isOrderEffectivelyCompleted(o)) return false;
          if (o.order_status !== "ready") return false;
          return payStatuses ? payStatuses.includes(o.payment_status) : true;
        }
        return (
          statuses.includes(o.order_status) &&
          (payStatuses ? payStatuses.includes(o.payment_status) : true)
        );
      }),
    [orders, isOrderEffectivelyCompleted]
  );

  if (!tenant) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div
      style={{ minHeight: "100vh", background: "#f1f5f9" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullY > 0 && (
        <div
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center transition-all"
          style={{ height: pullY, background: "rgba(0,0,0,0.05)" }}
        >
          <div className={`flex flex-col items-center gap-1 transition-all ${pullY >= PULL_THRESHOLD ? "opacity-100" : "opacity-50"}`}>
            <span className={`text-2xl transition-transform ${pullY >= PULL_THRESHOLD ? "rotate-180" : ""}`}>↓</span>
            <span className="text-xs font-bold text-gray-500">{pullY >= PULL_THRESHOLD ? "Lepas untuk refresh" : "Tarik untuk refresh"}</span>
          </div>
        </div>
      )}
      {/* ─── Header ─── */}
      <header
        className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between shadow-md gap-3"
        style={{ background: "linear-gradient(135deg, var(--tenant-primary), var(--tenant-secondary, var(--tenant-primary)))" }}
      >
        <div className="flex-1 min-w-0">
          <h1 className="text-white font-bold text-xl leading-none truncate flex items-center gap-2">
            {tenant.name}
            {isPosOnly && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/20 text-white/90 tracking-wide">🏪 POS</span>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-white/70 text-xs">
              {isPosOnly ? "Kasir POS Murni" : "Layar Kasir"} · <span className="font-semibold">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</span>
            </p>
            {lastSynced && (
              <span className="text-white/50 text-[10px] font-medium">
                · Sync {lastSynced.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Manual Sync Button - improved UX */}
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            title={isSyncing ? "Sedang sinkronisasi..." : "Sinkronkan Data"}
            className="relative flex items-center gap-1.5 text-white/80 hover:text-white text-xs font-bold border border-white/30 px-3 py-2 rounded-xl hover:bg-white/10 transition-all disabled:opacity-60 overflow-hidden"
          >
            {isSyncing ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin flex-shrink-0" />
                <span className="hidden sm:inline">Sinkron...</span>
              </>
            ) : (
              <>
                <span className="text-sm">🔄</span>
                <span className="hidden sm:inline">Sinkronkan</span>
              </>
            )}
          </button>
          <a
            href="analytics"
            className="flex items-center gap-1.5 text-white/80 hover:text-white text-sm font-medium border border-white/30 px-3 py-2 rounded-xl hover:bg-white/10 transition-all"
          >
            📊 <span className="hidden sm:inline">Analitik</span>
          </a>
          <button
            onClick={() => setNewOrderDrawer(true)}
            className="flex items-center gap-2 bg-white font-bold text-sm px-4 py-2 rounded-xl shadow hover:shadow-md active:scale-95 transition-all"
            style={{ color: "var(--tenant-primary)" }}
          >
            <span className="text-lg leading-none">＋</span> <span className="hidden sm:inline">Pesanan Baru</span>
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
        okButtonProps={{ danger: true, loading: submitting["void"] }}
      >
        <Form form={voidForm} onFinish={handleVoid} layout="vertical">
          <Form.Item name="reason" label="Alasan pembatalan" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="Tuliskan alasan..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* ─── POS Pay & Receipt Modal ─── */}
      <Modal
        open={payModal.open}
        onCancel={() => { setPayModal({ open: false, order: null }); setCashReceived(null); }}
        footer={null}
        width={600}
        centered
        destroyOnHidden
        title={
          <div className="flex items-center gap-3 pb-2 border-b">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold flex-shrink-0">
              💳
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 leading-tight">
                {payModal.autoComplete ? "Tandai Lunas & Selesaikan Pesanan" : "Tandai Lunas"}
              </h3>
              <p className="text-xs text-gray-400 font-normal mt-0.5">
                {payModal.order ? `No. Antrian #${payModal.order.queue_number}` : ""}
                {payModal.order?.table_number ? ` · Meja ${payModal.order.table_number}` : ""}
                {payModal.order?.order_type ? ` · ${payModal.order.order_type === "takeaway" ? "Takeaway" : "Dine-in"}` : ""}
              </p>
            </div>
          </div>
        }
      >
        {payModal.order && (
          <div className="space-y-4 pt-2">
            {/* ── 1. Detail Belanja (Struk Preview / Itemized List) ── */}
            <div className="bg-gray-50 rounded-xl p-3.5 border space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Rincian Items</p>
                <span className="text-[11px] text-gray-400">{payModal.order.items?.length ?? 0} Jenis Menu</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-100 text-xs">
                {payModal.order.items?.map((it, idx) => (
                  <div key={idx} className="pt-1.5 first:pt-0 flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-800">
                        <span className="text-indigo-600 font-bold mr-1">×{it.quantity}</span>
                        {it.product_name_snapshot}
                      </p>
                      {it.selected_variants?.map((v, vi) => (
                        <p key={vi} className="text-[11px] text-gray-400">↳ {v.group}: {v.option}</p>
                      ))}
                      {it.notes && <p className="text-[11px] text-amber-600">📝 {it.notes}</p>}
                    </div>
                    <p className="font-semibold text-gray-700">Rp {it.subtotal.toLocaleString("id-ID")}</p>
                  </div>
                ))}
              </div>

              {/* Finance Breakdown */}
              <div className="border-t pt-2 space-y-1 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>Rp {payModal.order.subtotal.toLocaleString("id-ID")}</span>
                </div>
                {payModal.order.tax_amount > 0 && (
                  <div className="flex justify-between">
                    <span>Pajak ({fc?.tax_percentage}%)</span>
                    <span>Rp {payModal.order.tax_amount.toLocaleString("id-ID")}</span>
                  </div>
                )}
                {payModal.order.service_charge_amount > 0 && (
                  <div className="flex justify-between">
                    <span>Service Charge ({fc?.service_charge_percentage}%)</span>
                    <span>Rp {payModal.order.service_charge_amount.toLocaleString("id-ID")}</span>
                  </div>
                )}
                {payModal.order.takeaway_fee_amount > 0 && (
                  <div className="flex justify-between">
                    <span>Biaya Takeaway</span>
                    <span>Rp {payModal.order.takeaway_fee_amount.toLocaleString("id-ID")}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t font-extrabold text-base text-gray-900">
                  <span>TOTAL BELANJA</span>
                  <span style={{ color: "var(--tenant-primary)" }}>
                    Rp {payModal.order.total_amount.toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
            </div>

            {/* ── 2. Pilih Metode Pembayaran ── */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Pilih Metode Pembayaran
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: "cash", label: "Tunai / Cash", icon: "💵" },
                  { key: "qris_static", label: "QRIS", icon: "📱" },
                  { key: "bank_transfer", label: "Transfer Bank", icon: "🏦" },
                  ...(bl?.payment_mode === "gateway" ? [{ key: "gateway", label: "Gateway", icon: "💳" }] : []),
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      setPayMethod(m.key as PaymentMethodType);
                      if (m.key === "cash" && cashReceived === null) {
                        setCashReceived(payModal.order?.total_amount ?? 0);
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center gap-1 ${payMethod === m.key
                      ? "border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-sm ring-2 ring-indigo-500/20"
                      : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
                      }`}
                  >
                    <span className="text-xl">{m.icon}</span>
                    <span className="text-xs font-bold">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── 3. Kalkulator Uang Tunai (jika Tunai/Cash) ── */}
            {payMethod === "cash" && (
              <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-amber-900 flex items-center gap-1">
                    💵 Uang Diterima (Nominal Bayar)
                  </label>
                  <span className="text-[11px] text-amber-700 font-medium">Input atau Pilih Uang Pas</span>
                </div>

                <Space.Compact className="w-full" size="large">
                  <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 bg-gray-50 rounded-l-lg font-bold text-gray-600 text-sm">
                    Rp
                  </span>
                  <InputNumber
                    className="w-full text-lg font-bold"
                    size="large"
                    value={cashReceived}
                    onChange={(v) => setCashReceived(v)}
                    formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                    parser={(val) => Number(val?.replace(/\./g, "") || 0)}
                    placeholder="Masukkan nominal bayar..."
                  />
                </Space.Compact>

                {/* Smart Adaptive Quick Cash Denominations */}
                {payModal.order && (() => {
                  const total = payModal.order.total_amount;
                  // Standard IDR banknote denominations
                  const ALL_NOTES = [2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
                  // Smart rounding: nearest 10k, 50k, 100k above total
                  const smartRound = (n: number, step: number) => Math.ceil(n / step) * step;
                  const r10k = smartRound(total, 10000);
                  const r50k = smartRound(total, 50000);
                  const r100k = smartRound(total, 100000);
                  const smartSet = new Set([total, r10k, r50k, r100k]);
                  // Add banknotes only if >= total
                  ALL_NOTES.forEach((n) => { if (n >= total) smartSet.add(n); });
                  const options = Array.from(smartSet).sort((a, b) => a - b).slice(0, 7);

                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {options.map((val, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCashReceived(val)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all ${cashReceived === val
                            ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                            : "bg-white text-amber-900 border-amber-200 hover:bg-amber-100/50"
                            }`}
                        >
                          {val === total
                            ? `✨ Uang Pas (${val.toLocaleString("id-ID")})`
                            : `Rp ${val.toLocaleString("id-ID")}`}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {/* Result Kembalian / Uang Kurang */}
                {cashReceived !== null && payModal.order && (
                  <div className="pt-1">
                    {cashReceived >= payModal.order.total_amount ? (
                      <div className="bg-emerald-500 text-white rounded-xl p-3 flex items-center justify-between shadow-sm">
                        <span className="text-xs font-bold uppercase tracking-wider opacity-90">KEMBALIAN</span>
                        <span className="text-xl font-black">
                          Rp {(cashReceived - payModal.order.total_amount).toLocaleString("id-ID")}
                        </span>
                      </div>
                    ) : (
                      <div className="bg-rose-500 text-white rounded-xl p-2.5 flex items-center justify-between shadow-sm">
                        <span className="text-xs font-bold uppercase tracking-wider opacity-90">⚠️ UANG KURANG</span>
                        <span className="text-base font-extrabold">
                          Rp {(payModal.order.total_amount - cashReceived).toLocaleString("id-ID")}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 4. Opsi Print & Submit Buttons ── */}
            <div className="pt-2 border-t flex flex-col sm:flex-row items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printOnSubmit}
                  onChange={(e) => setPrintOnSubmit(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                Cetak Struk Belanja setelah pelunasan 🖨️
              </label>

              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  onClick={() => { setPayModal({ open: false, order: null }); setCashReceived(null); }}
                  className="flex-1 sm:flex-none"
                >
                  Batal
                </Button>
                <Button
                  type="default"
                  icon={<span>🖨️</span>}
                  onClick={handlePrintReceipt}
                  className="flex-1 sm:flex-none"
                >
                  Struk Only
                </Button>
                <Button
                  type="primary"
                  loading={submitting["pay"]}
                  disabled={payMethod === "cash" && (cashReceived === null || cashReceived < payModal.order.total_amount)}
                  onClick={handlePayConfirm}
                  className="flex-1 sm:flex-none font-bold"
                  style={{ background: payModal.autoComplete ? "#10b981" : undefined, borderColor: payModal.autoComplete ? "#10b981" : undefined }}
                >
                  {payModal.autoComplete ? "Konfirmasi Lunas & Selesai 🚀" : "Konfirmasi Lunas ✅"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── PRINTABLE THERMAL RECEIPT AREA (Standard Nasional Indonesia) ─── */}
      {printReceiptData && printReceiptData.order && tenant && (() => {
        const rc = tenant.receipt_config;
        const paperWidth = rc?.paper_size === "58mm" ? "58mm" : "80mm";
        const o = printReceiptData.order;
        const custName = o.customer_name ||
          parseCustomerNotes(o.customer_notes).customerName || undefined;
        return (
          <div
            id="receipt-print-area"
            className="hidden print:block font-mono text-black leading-snug"
            style={{ width: paperWidth, margin: "0 auto", fontSize: "10px", padding: "4px" }}
          >
            {/* ── Header ── */}
            <div style={{ textAlign: "center", marginBottom: "6px" }}>
              {rc?.show_logo && tenant.logo_url && (
                <img src={tenant.logo_url} alt={tenant.name}
                  style={{ width: "40px", height: "40px", objectFit: "contain", margin: "0 auto 4px" }}
                />
              )}
              <div style={{ fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {tenant.name}
              </div>
              {rc?.header_text && (
                <div style={{ fontSize: "9px", marginTop: "2px", whiteSpace: "pre-line", color: "#444" }}>
                  {rc.header_text}
                </div>
              )}
              {rc?.show_wifi_info && rc.wifi_name && (
                <div style={{ fontSize: "9px", marginTop: "3px", border: "1px dashed #999", padding: "2px 4px", display: "inline-block" }}>
                  WiFi: <strong>{rc.wifi_name}</strong>{rc.wifi_password ? ` · Pass: ${rc.wifi_password}` : ""}
                </div>
              )}
            </div>

            {/* ── Order Info ── */}
            <div style={{ borderTop: "1px dashed #000", borderBottom: "1px dashed #000", padding: "4px 0", marginBottom: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>No. Antrian</span>
                <span style={{ fontWeight: 700 }}>#{o.queue_number}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Waktu</span>
                <span>{new Date(o.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Tipe</span>
                <span style={{ fontWeight: 700 }}>{o.order_type === "takeaway" ? "TAKEAWAY" : "DINE-IN"}</span>
              </div>
              {o.table_number && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Meja</span>
                  <span style={{ fontWeight: 700 }}>{o.table_number}</span>
                </div>
              )}
              {custName && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Pelanggan</span>
                  <span style={{ fontWeight: 700 }}>{custName}</span>
                </div>
              )}
            </div>

            {/* ── Item List: Name / Unit Price × Qty = Subtotal ── */}
            <div style={{ borderBottom: "1px dashed #000", paddingBottom: "4px", marginBottom: "4px" }}>
              {o.items?.map((it, idx) => (
                <div key={idx} style={{ marginBottom: "4px" }}>
                  <div style={{ fontWeight: 700 }}>{it.product_name_snapshot}</div>
                  {it.selected_variants?.map((v, vi) => (
                    <div key={vi} style={{ fontSize: "8px", color: "#555", paddingLeft: "6px" }}>
                      ↳ {v.group}: {v.option}{v.additional_price > 0 ? ` (+${v.additional_price.toLocaleString("id-ID")})` : ""}
                    </div>
                  ))}
                  {it.notes && (
                    <div style={{ fontSize: "8px", color: "#777", paddingLeft: "6px" }}>📝 {it.notes}</div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: "6px" }}>
                    <span>{it.unit_price.toLocaleString("id-ID")} × {it.quantity}</span>
                    <span style={{ fontWeight: 600 }}>Rp {(it.unit_price * it.quantity).toLocaleString("id-ID")}</span>
                  </div>
                  {/* Variant extra price per item if any */}
                  {it.selected_variants?.some((v) => v.additional_price > 0) && (
                    <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: "6px", fontSize: "8px", color: "#555" }}>
                      <span>Harga Dasar: {it.base_price_snapshot.toLocaleString("id-ID")} / item</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Financial Summary ── */}
            <div style={{ marginBottom: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Subtotal</span><span>Rp {o.subtotal.toLocaleString("id-ID")}</span>
              </div>
              {o.tax_amount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>PPN ({o.finance_snapshot?.tax_percentage ?? tenant.finance_config.tax_percentage}%)</span>
                  <span>Rp {o.tax_amount.toLocaleString("id-ID")}</span>
                </div>
              )}
              {o.service_charge_amount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Service Charge ({o.finance_snapshot?.service_charge_percentage ?? tenant.finance_config.service_charge_percentage}%)</span>
                  <span>Rp {o.service_charge_amount.toLocaleString("id-ID")}</span>
                </div>
              )}
              {o.takeaway_fee_amount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Biaya Takeaway</span><span>Rp {o.takeaway_fee_amount.toLocaleString("id-ID")}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "12px", borderTop: "1px solid #000", paddingTop: "3px", marginTop: "3px" }}>
                <span>TOTAL</span><span>Rp {o.total_amount.toLocaleString("id-ID")}</span>
              </div>
            </div>

            {/* ── Payment ── */}
            <div style={{ borderTop: "1px dashed #000", paddingTop: "4px", marginBottom: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Metode Bayar</span>
                <span style={{ fontWeight: 700, textTransform: "uppercase" }}>
                  {printReceiptData.payMethod === "cash" ? "TUNAI" :
                   printReceiptData.payMethod === "qris_static" ? "QRIS" :
                   printReceiptData.payMethod === "bank_transfer" ? "TRANSFER" : printReceiptData.payMethod}
                </span>
              </div>
              {printReceiptData.payMethod === "cash" && printReceiptData.cashReceived !== null && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Tunai Diterima</span><span>Rp {printReceiptData.cashReceived.toLocaleString("id-ID")}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>Kembalian</span>
                    <span>Rp {Math.max(0, printReceiptData.cashReceived - o.total_amount).toLocaleString("id-ID")}</span>
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                <span>Status</span><span>LUNAS ✓</span>
              </div>
            </div>

            {/* ── Footer ── */}
            {rc?.footer_text && (
              <div style={{ borderTop: "1px dashed #000", paddingTop: "4px", textAlign: "center", fontSize: "9px", marginTop: "4px" }}>
                <p style={{ whiteSpace: "pre-line" }}>{rc.footer_text}</p>
              </div>
            )}
            <div style={{ textAlign: "center", marginTop: "6px", fontSize: "9px", color: "#888" }}>
              — Terima Kasih Atas Kunjungan Anda —
            </div>
          </div>
        );
      })()}

      {/* Inline Print Style — paper_size aware */}
      <style jsx global>{`
        @page {
          size: ${tenant.receipt_config?.paper_size === "58mm" ? "58mm" : "80mm"} auto;
          margin: 0;
        }
        @media print {
          body * { visibility: hidden !important; }
          #receipt-print-area, #receipt-print-area * { visibility: visible !important; }
          #receipt-print-area {
            position: fixed !important;
            left: 0 !important; top: 0 !important;
            width: ${tenant.receipt_config?.paper_size === "58mm" ? "58mm" : "80mm"} !important;
            background: white !important;
            color: black !important;
          }
        }
      `}</style>

      {/* ──────────────── POS ORDER DRAWER (RESPONSIVE DESKTOP/TABLET/HP) ──────────────── */}
      <Drawer
        title={null}
        placement="right"
        width={drawerWidth}
        open={newOrderDrawer}
        onClose={() => {
          setNewOrderDrawer(false);
          setCart([]);
          setTableNumber("");
          setCustomerNotes("");
          setOrderType("dine_in");
          setPosMobileTab("menu");
        }}
        styles={{ body: { padding: 0, overflow: "hidden", background: "#f8fafc" }, header: { display: "none" } }}
      >
        <div className="flex flex-col h-full w-full bg-slate-50" style={{ fontFamily: "Inter, sans-serif" }}>

          {/* ── Top Header Bar ── */}
          <div
            className="px-4 py-3 bg-white border-b shadow-2xs flex items-center justify-between gap-3 flex-shrink-0 z-20"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg text-white flex-shrink-0 shadow-xs"
                style={{ background: "var(--tenant-primary)" }}
              >
                🛒
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-gray-900 leading-none truncate">
                    Input Pesanan Baru
                  </h2>
                  {tenant && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white hidden sm:inline-block"
                      style={{ background: "var(--tenant-primary)" }}
                    >
                      {tenant.name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  Kasir POS · {cart.reduce((s, c) => s + c.quantity, 0)} item dipilih
                </p>
              </div>
            </div>

            {/* Mobile Tab Switcher (Visible only on mobile screens < 768px / md) */}
            <div className="flex md:hidden items-center bg-gray-100 p-1 rounded-xl border border-gray-200">
              <button
                type="button"
                onClick={() => setPosMobileTab("menu")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${posMobileTab === "menu"
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-500 hover:text-gray-700"
                  }`}
              >
                🍽️ Menu ({visibleProducts.length})
              </button>
              <button
                type="button"
                onClick={() => setPosMobileTab("cart")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative ${posMobileTab === "cart"
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-500 hover:text-gray-700"
                  }`}
              >
                🛒 Cart ({cart.reduce((s, c) => s + c.quantity, 0)})
                {cart.length > 0 && (
                  <span
                    className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] font-black text-white"
                    style={{ background: "var(--tenant-primary)" }}
                  >
                    ●
                  </span>
                )}
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={() => {
                setNewOrderDrawer(false);
                setCart([]);
                setPosMobileTab("menu");
              }}
              className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center font-bold text-lg transition-colors flex-shrink-0"
              title="Tutup"
            >
              ✕
            </button>
          </div>

          {/* ── Main Responsive Content Area (Split-screen on desktop/tablet, tabbed on mobile) ── */}
          <div className="flex-1 flex flex-col md:flex-row min-h-0 relative overflow-hidden">

            {/* ── LEFT: Product Catalog Panel (Menu) ── */}
            <div
              className={`flex-col md:flex md:w-[54%] lg:w-[55%] xl:w-[56%] min-w-0 border-r bg-gray-50/70 h-full ${posMobileTab === "menu" ? "flex flex-1" : "hidden md:flex"
                }`}
            >
              {/* Search & Category Filter Header */}
              <div className="p-3 sm:p-4 bg-white border-b shadow-2xs space-y-2.5 flex-shrink-0">
                {/* Search Bar */}
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    🔍
                  </span>
                  <input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Cari nama menu, minuman, atau makanan..."
                    className="w-full text-sm pl-9 pr-8 py-2.5 border rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                  />
                  {productSearch && (
                    <button
                      onClick={() => setProductSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 font-bold text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Category Pills Bar */}
                {categories.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedCat(null)}
                      className="whitespace-nowrap text-xs font-bold px-3.5 py-1.5 rounded-full flex-shrink-0 transition-all border"
                      style={
                        !selectedCat
                          ? {
                            background: "var(--tenant-primary)",
                            color: "#fff",
                            borderColor: "var(--tenant-primary)",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                          }
                          : { background: "#fff", color: "#64748b", borderColor: "#e2e8f0" }
                      }
                    >
                      Semua ({products.length})
                    </button>
                    {categories.map((cat) => {
                      const catCount = products.filter((p) => p.category_id === cat.id).length;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedCat(cat.id)}
                          className="whitespace-nowrap text-xs font-bold px-3.5 py-1.5 rounded-full flex-shrink-0 transition-all border"
                          style={
                            selectedCat === cat.id
                              ? {
                                background: "var(--tenant-primary)",
                                color: "#fff",
                                borderColor: "var(--tenant-primary)",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                              }
                              : { background: "#fff", color: "#64748b", borderColor: "#e2e8f0" }
                          }
                        >
                          {cat.name} ({catCount})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Product Grid Area (Powered by Reusable ProductCard - Cashier Mode) */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 content-start">
                {visibleProducts.length === 0 && (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center text-gray-400">
                    <span className="text-5xl mb-3">🍽️</span>
                    <p className="text-sm font-semibold text-gray-600">Tidak ada menu ditemukan</p>
                    <p className="text-xs text-gray-400 mt-1">Coba kata kunci pencarian lain</p>
                  </div>
                )}
                {visibleProducts.map((p) => {
                  const inCartCount = cart
                    .filter((c) => c.product.id === p.id)
                    .reduce((s, c) => s + c.quantity, 0);

                  return (
                    <ProductCard
                      key={p.id}
                      product={p}
                      role="cashier"
                      quantity={inCartCount}
                      primaryColor="var(--tenant-primary)"
                      secondaryColor="var(--tenant-secondary)"
                      onAddToCart={addToCart}
                      onUpdateQuantity={updateProductQuantityInCart}
                    />
                  );
                })}
              </div>

              {/* Floating Mobile Cart Bar (Visible on mobile only when in menu tab & cart has items) */}
              {cart.length > 0 && (
                <div className="p-3 bg-white border-t md:hidden flex-shrink-0 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setPosMobileTab("cart")}
                    className="w-full py-3.5 rounded-2xl text-white font-bold text-sm flex items-center justify-between px-4 shadow-md active:scale-95 transition-all"
                    style={{ background: "var(--tenant-primary)" }}
                  >
                    <span className="bg-white/25 px-2.5 py-0.5 rounded-full text-xs font-extrabold">
                      🛒 {cart.reduce((s, c) => s + c.quantity, 0)} Item
                    </span>
                    <span>Lihat Rincian Pesanan →</span>
                    <span className="font-black text-sm">
                      Rp {cartTotal.toLocaleString("id-ID")}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* ── RIGHT: Order Details & Cart Panel ── */}
            <div
              className={`flex-col md:flex md:w-[46%] lg:w-[45%] xl:w-[44%] min-w-[340px] bg-white h-full ${posMobileTab === "cart" ? "flex flex-1" : "hidden md:flex"
                }`}
            >
              {/* Cart Header (Mobile Back Button + Title) */}
              <div className="px-4 py-3 border-b bg-gray-50 shadow-2xs flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPosMobileTab("menu")}
                    className="md:hidden text-gray-500 hover:text-gray-800 font-bold text-sm bg-white px-2.5 py-1 rounded-lg border shadow-2xs"
                  >
                    ← Kembali ke Menu
                  </button>
                  <h3 className="text-sm font-extrabold text-gray-800 hidden md:block">
                    Detail &amp; Keranjang Pesanan
                  </h3>
                </div>
                <span className="text-xs font-bold text-gray-500 bg-gray-200/70 px-2.5 py-1 rounded-full">
                  {cart.reduce((s, c) => s + c.quantity, 0)} item
                </span>
              </div>

              {/* Order Settings Section (Compact 2-Column Layout) */}
              <div className="p-3 border-b space-y-2 bg-white flex-shrink-0">
                {/* Row 1: Order Type Toggle */}
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex-shrink-0">
                    Tipe:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 flex-1">
                    {(["dine_in", "takeaway"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setOrderType(t)}
                        className="py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 shadow-2xs cursor-pointer"
                        style={
                          orderType === t
                            ? {
                              background: "var(--tenant-primary)",
                              color: "#fff",
                              border: "1.5px solid var(--tenant-primary)",
                            }
                            : { background: "#f8fafc", color: "#64748b", border: "1.5px solid #e2e8f0" }
                        }
                      >
                        <span>{t === "dine_in" ? "🍽️" : "🛍️"}</span>
                        <span>{t === "dine_in" ? "Dine-In" : "Takeaway"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Row 2: 2-Column Grid for Customer Name & Table Number */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                      👤 Pemesan {orderType === "dine_in" ? <span className="text-gray-400 font-normal lowercase">(opt)</span> : <span className="text-rose-500">*</span>}
                    </label>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Nama panggilan..."
                      className="w-full text-xs font-semibold px-2.5 py-1.5 border rounded-lg bg-gray-50/80 outline-none focus:bg-white focus:border-indigo-500 transition-all text-gray-900"
                    />
                  </div>

                  {bl?.numbering === "table" && orderType !== "takeaway" ? (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                        🪑 No. Meja <span className="text-rose-500">*</span>
                      </label>
                      <input
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        placeholder="Contoh: 05..."
                        className="w-full text-xs font-semibold px-2.5 py-1.5 border rounded-lg bg-gray-50/80 outline-none focus:bg-white focus:border-indigo-500 transition-all text-gray-900"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                        📦 Detail
                      </label>
                      <div className="text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1.5 rounded-lg text-center">
                        Bawa Pulang
                      </div>
                    </div>
                  )}
                </div>

                {/* Row 3: Compact 1-line Customer Notes */}
                <div>
                  <input
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    placeholder="📝 Catatan pesanan (opsional)..."
                    className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-gray-50/80 outline-none focus:bg-white focus:border-indigo-500 transition-all text-gray-900 placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Cart Items List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-gray-50/50">
                {cart.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-300">
                    <span className="text-5xl mb-2">🛒</span>
                    <p className="text-sm font-semibold text-gray-500">Keranjang Masih Kosong</p>
                    <p className="text-xs text-gray-400 mt-1 text-center px-4">
                      Klik hidangan di sebelah kiri untuk menambahkan ke daftar pesanan
                    </p>
                  </div>
                )}
                {cart.map((item, i) => (
                  <div key={i} className="bg-white rounded-2xl p-3.5 border border-gray-200/80 shadow-2xs space-y-2.5">
                    {/* Row 1: Image + Title + Unit Price + Delete Button */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        {item.product.image_urls[0] ? (
                          <div className="w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden bg-gray-50 border flex items-center justify-center">
                            <img src={item.product.image_urls[0]} alt={item.product.name} className="w-full h-full object-contain p-0.5" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 flex-shrink-0 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold">
                            🍽️
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-xs leading-tight text-gray-900 line-clamp-2">
                            {item.product.name}
                          </p>
                          <p className="text-[11px] font-semibold text-gray-500 mt-0.5">
                            @ Rp {item.unit_price.toLocaleString("id-ID")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-rose-500 hover:text-rose-700 text-[11px] font-bold bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
                      >
                        Hapus
                      </button>
                    </div>

                    {/* Row 2: Subtotal & Stepper */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-gray-400 font-medium">Total:</span>
                        <span className="text-xs font-black text-gray-900">
                          Rp {(item.unit_price * item.quantity).toLocaleString("id-ID")}
                        </span>
                      </div>

                      {/* Stepper */}
                      <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-xl p-1">
                        <button
                          type="button"
                          onClick={() => setCartQty(i, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg bg-white hover:bg-gray-200 flex items-center justify-center font-black text-gray-700 text-sm leading-none shadow-2xs"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => setCartQty(i, parseInt(e.target.value) || 1)}
                          className="w-8 text-center text-xs font-black bg-transparent outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setCartQty(i, item.quantity + 1)}
                          className="w-7 h-7 rounded-lg text-white flex items-center justify-center font-black text-sm leading-none shadow-2xs"
                          style={{ background: "var(--tenant-primary)" }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Row 3: Item Notes Input (Full width) */}
                    <div>
                      <input
                        value={item.notes || ""}
                        onChange={(e) => setCartNotes(i, e.target.value)}
                        placeholder="Catatan item (contoh: pedas, es sedikit, dll)..."
                        className="w-full text-xs px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-colors placeholder-gray-400 font-medium"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Finance Summary & Action Buttons */}
              <div className="border-t p-3.5 sm:p-4 space-y-3 bg-white flex-shrink-0 shadow-lg">
                {cart.length > 0 && (
                  <div className="space-y-1.5 text-xs text-gray-600 border-b pb-2.5">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-semibold">Rp {cartSubtotal.toLocaleString("id-ID")}</span>
                    </div>
                    {cartTax > 0 && (
                      <div className="flex justify-between">
                        <span>Pajak ({fc?.tax_percentage}%)</span>
                        <span>Rp {cartTax.toLocaleString("id-ID")}</span>
                      </div>
                    )}
                    {cartSvc > 0 && (
                      <div className="flex justify-between">
                        <span>Service Charge ({fc?.service_charge_percentage}%)</span>
                        <span>Rp {cartSvc.toLocaleString("id-ID")}</span>
                      </div>
                    )}
                    {cartTkwy > 0 && (
                      <div className="flex justify-between">
                        <span>Biaya Takeaway</span>
                        <span>Rp {cartTkwy.toLocaleString("id-ID")}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-extrabold text-base pt-1 text-gray-900">
                      <span>Total Tagihan</span>
                      <span style={{ color: "var(--tenant-primary)" }}>
                        Rp {cartTotal.toLocaleString("id-ID")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Dual Submit Buttons (Stacked for max legibility & zero text wrapping) */}
                <div className="space-y-2 w-full">
                  <button
                    type="button"
                    onClick={() => handleCreateCashierOrder("pay_now")}
                    disabled={cart.length === 0 || submitting["createOrder"]}
                    className="w-full py-3.5 px-4 rounded-xl font-bold text-white text-sm transition-all shadow-md flex items-center justify-between active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    style={{
                      background: cart.length > 0 && !submitting["createOrder"] ? "var(--tenant-primary)" : "#94a3b8",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">💳</span>
                      <span>{isPosOnly ? "Proses & Bayar Sekarang" : "Bayar & Masuk Dapur"}</span>
                    </div>
                    {cart.length > 0 && (
                      <span className="text-sm font-extrabold bg-white/20 px-2.5 py-0.5 rounded-lg backdrop-blur-xs">
                        Rp {cartTotal.toLocaleString("id-ID")}
                      </span>
                    )}
                  </button>

                  {!isPosOnly && (
                  <button
                    type="button"
                    onClick={() => handleCreateCashierOrder("save_pending")}
                    disabled={cart.length === 0 || submitting["createOrder"]}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>⏳</span>
                    <span>Simpan ke Waiting List (Menunggu)</span>
                  </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </Drawer>
    </div>
  );
}

function CashierUndoButton({ label, onUndo }: { label: string; onUndo: () => void }) {
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  return (
    <div className="w-full space-y-1">
      <div className="h-1.5 rounded-full overflow-hidden bg-gray-200">
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 5, ease: "linear" }}
        />
      </div>
      <button
        onClick={onUndo}
        className="w-full py-1 px-2 rounded-lg font-bold text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors border border-amber-300 shadow-sm"
      >
        ↩️ Urungkan {label} ({remaining}s)
      </button>
    </div>
  );
}
