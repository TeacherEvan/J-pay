"use client";

import { useMutation, useQuery } from "@/lib/backend/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/backend/api";

/**
 * Resolve the active service worker registration WITHOUT hanging forever on
 * `navigator.serviceWorker.ready` (which never settles if Serwist failed to
 * register — audit 2026-11-11, D12). Prefer an existing registration; race
 * `ready` against a timeout; null means "not available right now".
 */
async function swRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
  } catch {
    /* fall through to the ready race */
  }
  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

type NotifState = "unknown" | "unsupported" | "off" | "on" | "denied";

export function EnableNotifications() {
  const vapidKey = useQuery(api.push_subs.publicVapidKey);
  const save = useMutation(api.push_subs.saveSubscription);
  const remove = useMutation(api.push_subs.deleteMySubscription);
  // U11: tri-state init kills the SSR/CSR hydration mismatch — the real
  // permission + subscription state is read after mount only.
  const [state, setState] = useState<NotifState>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      try {
        const reg = await swRegistration();
        if (!reg) { if (!cancelled) setState("off"); return; }
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setError(null);
    if (!vapidKey) {
      setError("Push not configured on this deployment (VAPID keys missing).");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await swRegistration();
      if (!reg) {
        setError("Notifications need the offline service worker, which is not active yet — reload once and try again.");
        return;
      }
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      const json = sub.toJSON();
      await save({
        endpoint: sub.endpoint,
        keysP256dh: json.keys!.p256dh!,
        keysAuth: json.keys!.auth!,
      });
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      const reg = await swRegistration();
      if (!reg) {
        setError("Notifications need the offline service worker, which is not active yet — reload once and try again.");
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await remove({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      } else {
        await remove({});
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "unknown") {
    return (
      <button disabled className="btn-surgical pill-surgical rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--fog)]">
        Notifications…
      </button>
    );
  }
  if (state === "unsupported") {
    return (
      <span className="text-xs text-[var(--fog)]" title="This browser or deployment does not support push">
        Notifications unavailable
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span
        className="text-xs text-[var(--fog)]"
        title="Notifications were blocked in the browser — re-enable them in the site settings to receive alerts"
      >
        Notifications blocked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => void (state === "on" ? disable() : enable())}
        disabled={busy}
        aria-pressed={state === "on"}
        className={`btn-surgical pill-surgical rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
          state === "on" ? "border-[var(--mint)]/60 text-[var(--mint)]" : "text-[var(--fog)]"
        }`}
      >
        {state === "on" ? "Notifications on — tap to disable" : "Enable notifications"}
      </button>
      {error && (
        <span role="alert" className="max-w-[14rem] truncate text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}
