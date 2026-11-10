"use client";

import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";

export type GeofenceFix = {
  employeeName: string;
  status: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  siteName: string;
  siteLat: number;
  siteLng: number;
  siteRadius: number;
  isWithinGeofence: boolean;
  impossibleTravelFlag: boolean;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("data-focus-skip")
  );
}

export function GeofenceModal({ fix, onClose }: { fix: GeofenceFix; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [L, setL] = useState<typeof LType | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = getFocusable(dialog);
      if (focusables.length > 0) focusables[0].focus();
    }
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = getFocusable(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (!cancelled) setL((mod.default ?? mod) as typeof LType);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!L || !containerRef.current || !fix) return;
    const map = L.map(containerRef.current).setView([fix.siteLat, fix.siteLng], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    L.circle([fix.siteLat, fix.siteLng], {
      radius: fix.siteRadius,
      color: "#10b981",
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(map);
    const inside = fix.isWithinGeofence;
    L.circleMarker([fix.lat, fix.lng], {
      radius: 6,
      color: inside ? "#34d399" : "#f87171",
      fillColor: inside ? "#34d399" : "#f87171",
      fillOpacity: 0.9,
    }).addTo(map);
    if (Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters > 0) {
      L.circle([fix.lat, fix.lng], {
        radius: fix.accuracyMeters,
        color: "#94a3b8",
        weight: 1,
        dashArray: "4 4",
        fill: false,
      }).addTo(map);
    }
    return () => {
      map.remove();
    };
  }, [L, fix]);

  if (!fix) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-[var(--ink)]/75 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Geofence and audit detail"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg card-surgical p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-[var(--paper)]">
            {fix.employeeName} · {fix.status}
          </h3>
          <button
            onClick={onClose}
            className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider"
          >
            Close
          </button>
        </div>
        <div
          ref={containerRef}
          className="h-64 w-full overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel-2)]"
          data-focus-skip="true"
          tabIndex={-1}
        />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-[var(--text-secondary)]">
          <dt className="uppercase tracking-wider font-mono text-xs text-[var(--fog)]">Site</dt>
          <dd className="text-[var(--paper)]">{fix.siteName}</dd>
          <dt className="uppercase tracking-wider font-mono text-xs text-[var(--fog)]">Geofence radius</dt>
          <dd className="text-[var(--paper)] tnum font-mono">{fix.siteRadius} m</dd>
          <dt className="uppercase tracking-wider font-mono text-xs text-[var(--fog)]">GPS accuracy</dt>
          <dd className="text-[var(--paper)] tnum font-mono">±{fix.accuracyMeters} m</dd>
          <dt className="uppercase tracking-wider font-mono text-xs text-[var(--fog)]">Verdict</dt>
          <dd className={fix.isWithinGeofence ? "text-[var(--mint)] font-medium" : "text-[var(--danger)] font-medium"}>
            {fix.isWithinGeofence ? "inside geofence" : "outside geofence"}
            {fix.impossibleTravelFlag ? " · travel flag" : ""}
          </dd>
        </dl>
      </div>
    </div>
  );
}
