"use client";

import { useCallback, useEffect, useState } from "react";
import {
  outboxAll,
  outboxCount,
  outboxEnqueue,
  outboxRemove,
  type OutboxEntry,
} from "@/lib/outbox";

// Module-global flush lock. Protocol: `flushLock` holds the timestamp (ms) of
// when the current flush acquired the lock, or null when free. A flush that
// finds the lock held younger than STALE_MS backs off; an older lock is
// presumed abandoned (the holder threw/hung between acquire and release) and
// is stolen. Release happens in `finally`, so a throwing flush can never wedge
// future flushes — and even a never-settling one ages out within STALE_MS.
const STALE_MS = 30_000;
let flushLock: number | null = null;

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
    if (flushLock !== null && Date.now() - flushLock < STALE_MS) return;
    flushLock = Date.now();
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
    } catch (e) {
      // MT1 companion: outboxAll()/outboxRemove() can reject (blocked or
      // versioned-out IndexedDB). Without this the error escapes as an
      // unhandled promise rejection and the operator never sees it.
      setLastError(`Sync failed: ${String(e)}`);
    } finally {
      flushLock = null;
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
