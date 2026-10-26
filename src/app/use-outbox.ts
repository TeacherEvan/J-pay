"use client";

import { useCallback, useEffect, useState } from "react";
import {
  outboxAll,
  outboxCount,
  outboxEnqueue,
  outboxRemove,
  type OutboxEntry,
} from "@/lib/outbox";

let flushing = false;

export function useOutbox(flushOne: (entry: OutboxEntry) => Promise<void>) {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    outboxCount()
      .then(setCount)
      .catch(() => setCount(0));
  }, []);

  const flush = useCallback(async () => {
    if (flushing) return;
    flushing = true;
    setSyncing(true);
    try {
      const items = await outboxAll();
      for (const { key, entry } of items) {
        try {
          await flushOne(entry);
          await outboxRemove(key);
        } catch (e) {
          const msg = String(e);
          if (/WEAK_GPS|SITE_NOT|INACTIVE|FORBIDDEN/.test(msg)) {
            await outboxRemove(key);
            setLastError(`Dropped queued entry: ${msg}`);
          } else {
            setLastError(`Sync paused: ${msg}`);
            break;
          }
        }
      }
    } finally {
      flushing = false;
      setSyncing(false);
      refresh();
    }
  }, [flushOne, refresh]);

  const enqueue = useCallback(
    async (entry: OutboxEntry) => {
      await outboxEnqueue(entry);
      refresh();
      void flush();
    },
    [refresh, flush]
  );

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    const onOnline = () => void flush();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const interval = setInterval(refresh, 15000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [flush, refresh]);

  return { count, enqueue, flush, syncing, lastError };
}
