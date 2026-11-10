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
      // U5 fix: never let one stuck entry starve the rest of the queue.
      // Permanent (deterministic, server-side 4xx-class) rejections are dropped
      // loudly; anything else is SKIPPED for this pass and retried next flush.
      const PERMANENT = /WEAK_GPS|SITE_NOT|INACTIVE|FORBIDDEN|PAYROLL_SEALED|ENDED_BEFORE_START|ENDED_IN_FUTURE|INVALID_COORDS|UNKNOWN_FUNCTION/;
      let skipped = 0;
      for (const { key, entry } of items) {
        try {
          await flushOne(entry);
          await outboxRemove(key);
        } catch (e) {
          const msg = String(e);
          if (PERMANENT.test(msg)) {
            await outboxRemove(key);
            setLastError(`Dropped queued entry: ${msg}`);
          } else {
            skipped += 1;
            setLastError(`Sync paused: ${msg}`);
          }
        }
      }
      if (skipped > 0) {
        setLastError((prev) =>
          prev === null || !prev.startsWith("Sync paused")
            ? `${skipped} queued ${skipped === 1 ? "entry" : "entries"} pending — will retry when back online`
            : prev,
        );
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
