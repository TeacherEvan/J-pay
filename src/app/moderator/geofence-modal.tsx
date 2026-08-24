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

export function GeofenceModal({ fix, onClose }: { fix: GeofenceFix; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [L, setL] = useState<typeof LType | null>(null);

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
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Geofence detail for ${fix.employeeName}`}
    >
      <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">
            {fix.employeeName} · {fix.status}
          </h3>
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
        <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-md border border-neutral-800" />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
          <dt>Site</dt>
          <dd className="text-neutral-200">{fix.siteName}</dd>
          <dt>Geofence radius</dt>
          <dd className="text-neutral-200">{fix.siteRadius} m</dd>
          <dt>GPS accuracy</dt>
          <dd className="text-neutral-200">±{fix.accuracyMeters} m</dd>
          <dt>Verdict</dt>
          <dd className={fix.isWithinGeofence ? "text-emerald-400" : "text-red-400"}>
            {fix.isWithinGeofence ? "inside geofence" : "outside geofence"}
            {fix.impossibleTravelFlag ? " · travel flag" : ""}
          </dd>
        </dl>
      </div>
    </div>
  );
}
