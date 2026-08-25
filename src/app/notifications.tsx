"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

export function EnableNotifications() {
  const vapidKey = useQuery(api.push_subs.publicVapidKey);
  const save = useMutation(api.push_subs.saveSubscription);
  const [state, setState] = useState<"idle" | "on" | "off">(() =>
    typeof Notification === "undefined"
      ? "idle"
      : Notification.permission === "granted"
        ? "on"
        : "off"
  );

  async function enable() {
    if (!vapidKey) {
      alert("Push not configured on this deployment (VAPID keys missing).");
      return;
    }
    const permission = await Notification.requestPermission();
    setState(permission === "granted" ? "on" : "off");
    if (permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
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
  }

  return (
    <button
      onClick={() => void enable()}
      className="rounded-full border border-neutral-700 px-3 py-2.5 text-sm text-neutral-300 hover:border-emerald-500"
    >
      {state === "on" ? "Notifications on" : "Enable notifications"}
    </button>
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
