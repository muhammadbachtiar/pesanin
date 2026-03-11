"use client";

import { useEffect, useRef, useCallback } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { Order } from "@/types";

export function useRealtimeOrders(
    tenantId: string,
    onInsert?: (order: Order) => void,
    onUpdate?: (order: Order) => void
) {
    const audioRef = useRef<AudioContext | null>(null);

    const playBeep = useCallback(() => {
        try {
            const ctx = new AudioContext();
            audioRef.current = ctx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.4);
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
                (payload: { new: unknown }) => { playBeep(); onInsert?.(payload.new as Order); }
            )
            .on(
                "postgres_changes",
                { event: "UPDATE", schema: "public", table: "orders", filter: `tenant_id=eq.${tenantId}` },
                (payload: { new: unknown }) => { onUpdate?.(payload.new as Order); }
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [tenantId, onInsert, onUpdate, playBeep]);
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
