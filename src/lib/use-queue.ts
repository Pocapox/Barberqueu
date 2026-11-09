"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "./supabase-client";
import type { PublicQueueEntry, Shop } from "../types/database";

export function useQueue(shopId = process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001") {
  const [shop, setShop] = useState<Shop | null>(null);
  const [queue, setQueue] = useState<PublicQueueEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const active = useRef(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await fetch(`/api/queue/status?shopId=${encodeURIComponent(shopId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (active.current && request === sequence.current) { setShop(data.shop); setQueue(data.queue); setError(""); }
    } catch (e) {
      if (active.current && request === sequence.current) setError(e instanceof Error ? e.message : "No pudimos cargar la fila.");
    } finally { if (active.current) setLoading(false); }
  }, [shopId]);
  useEffect(() => {
    active.current = true;
    setLoading(true);
    setShop(null);
    setQueue([]);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15000);
    const focus = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("online", focus);
    let cleanup = () => {};
    try {
      const client = getSupabaseClient();
      const channel = client.channel(`queue:${shopId}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "shops", filter: `id=eq.${shopId}` }, () => { void refresh(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries", filter: `shop_id=eq.${shopId}`, select: ["id", "shop_id", "status", "position", "customer_name", "notified_upcoming"] }, () => { void refresh(); })
        .subscribe(status => { if (active.current) { setLive(status === "SUBSCRIBED"); if (status === "SUBSCRIBED") void refresh(); } });
      cleanup = () => { void client.removeChannel(channel); };
    } catch { setLive(false); }
    return () => { active.current = false; sequence.current++; clearInterval(timer); cleanup(); document.removeEventListener("visibilitychange", focus); window.removeEventListener("online", focus); };
  }, [refresh]);
  return { shop, queue, error, loading, live, refresh };
}
