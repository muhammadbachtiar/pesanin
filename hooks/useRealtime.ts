"use client";

import { useEffect, useRef, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { Order } from "@/types";

export function useRealtimeOrders(
    tenantId: string,
    onInsert?: (order: Order) => void,
    onUpdate?: (order: Order) => void,
    /** Jika disediakan, beep berbunyi. Kembalikan 'new' atau 'ready' untuk tone berbeda. */
    shouldBeep?: (order: Order) => boolean | "new" | "ready",
    shouldBeepOnUpdate?: (order: Order) => boolean | "new" | "ready"
) {
    const audioRef = useRef<AudioContext | null>(null);

    const playBeep = useCallback((type: "new" | "ready" = "new") => {
        try {
            const ctx = new AudioContext();
            audioRef.current = ctx;

            if (type === "ready") {
                // Tone yang beda (seperti ding-dong) untuk "Siap Diambil"
                const osc1 = ctx.createOscillator();
                const obj1 = ctx.createGain();
                osc1.connect(obj1);
                obj1.connect(ctx.destination);
                osc1.frequency.value = 659; // E5
                obj1.gain.setValueAtTime(0.5, ctx.currentTime);
                obj1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc1.start(ctx.currentTime);
                osc1.stop(ctx.currentTime + 0.5);

                const osc2 = ctx.createOscillator();
                const obj2 = ctx.createGain();
                osc2.connect(obj2);
                obj2.connect(ctx.destination);
                osc2.frequency.value = 523; // C5
                obj2.gain.setValueAtTime(0.5, ctx.currentTime + 0.2);
                obj2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
                osc2.start(ctx.currentTime + 0.2);
                osc2.stop(ctx.currentTime + 0.7);
            } else {
                // Tone default (beep 1x) untuk "Pesanan Masuk"
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880; // A5
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.4);
            }
        } catch { }
    }, []);

    useEffect(() => {
        if (!tenantId) return;
        const sb = getSupabaseClient();
        const channel = sb
            .channel(`orders:${tenantId}`)
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
                (payload: { new: unknown }) => {
                    const order = payload.new as Order;
                    const beepRes = shouldBeep ? shouldBeep(order) : true;
                    if (beepRes) playBeep(typeof beepRes === "string" ? beepRes : "new");
                    onInsert?.(order);
                }
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
                (payload: { new: unknown }) => {
                    const order = payload.new as Order;
                    const beepRes = shouldBeepOnUpdate?.(order);
                    if (beepRes) playBeep(typeof beepRes === "string" ? beepRes : "ready");
                    onUpdate?.(order);
                }
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [tenantId, onInsert, onUpdate, playBeep, shouldBeep, shouldBeepOnUpdate]);
}

export function useRealtimeProducts(tenantId: string, onUpdate?: (row: unknown) => void) {
    useEffect(() => {
        if (!tenantId) return;
        const sb = getSupabaseClient();
        const channel = sb
            .channel(`products:${tenantId}`)
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "products", filter: `tenant_id=eq.${tenantId}` },
                (payload: { new: unknown }) => onUpdate?.(payload.new)
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [tenantId, onUpdate]);
}
