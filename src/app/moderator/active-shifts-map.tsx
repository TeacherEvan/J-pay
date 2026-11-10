"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { bump, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";

type ActiveShiftRow = {
  _id: string;
  userId: string;
  name: string;
  startedAt: number;
  siteName?: string;
  siteLat?: number;
  siteLng?: number;
  siteRadiusMeters?: number;
  lastLog: {
    lat: number;
    lng: number;
    accuracyMeters: number;
    clientReportedTime: number;
    status: string;
    isWithinGeofence: boolean;
  } | null;
};

const MAP_TABLES = ["shifts", "logs", "users", "sites"] as const;
const AUTO_REFRESH_MS = 45_000;
const STALE_MS = 2 * 60 * 60 * 1000;

const SITE_COLOR = "#22d3ee";
const INSIDE_COLOR = "#34d399";
const OUTSIDE_COLOR = "#f87171";

function formatElapsed(startedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Build a popup as DOM nodes — names are user-controlled, never inject HTML. */
function popupElement(lines: Array<{ text: string; strong?: boolean; tone?: "good" | "bad" | "warn" }>): HTMLDivElement {
  const root = document.createElement("div");
  root.style.cssText = "min-width:180px;font:13px/1.45 system-ui,sans-serif";
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line.text;
    if (line.strong) row.style.fontWeight = "700";
    if (line.tone === "good") row.style.color = "#059669";
    if (line.tone === "bad") row.style.color = "#dc2626";
    if (line.tone === "warn") row.style.color = "#d97706";
    root.appendChild(row);
  }
  return root;
}

export function ActiveShiftsMap() {
  const rows = useQuery(api.moderator.activeShifts, {}) as ActiveShiftRow[] | undefined;
  const userLocale = useUserLocale();
  const [L, setL] = useState<typeof LType | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const layerRef = useRef<LType.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Leaflet is client-only; import after mount (same pattern as GeofenceModal).
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (!cancelled) setL((mod.default ?? mod) as typeof LType);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh via the shared invalidation bus (45s). Note this also
  // refreshes sibling moderator panels that share these tables — intended.
  useEffect(() => {
    const t = setInterval(() => bump({ tables: [...MAP_TABLES] }), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Stamp "updated at" whenever fresh rows arrive.
  useEffect(() => {
    if (rows !== undefined) setUpdatedAt(Date.now());
  }, [rows]);

  // Mount the map once L is ready and the container exists.
  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView([-25.7, 28.2], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, [L]);

  // Redraw layers on every refresh. fitBounds only on the first populated draw;
  // afterwards we keep the moderator's pan/zoom instead of yanking the map.
  const rowsKey = useMemo(() => JSON.stringify(rows ?? []), [rows]);
  useEffect(() => {
    if (!L || !mapRef.current || !layerRef.current || rows === undefined) return;
    const layer = layerRef.current;
    layer.clearLayers();

    const now = Date.now();
    const points: Array<[number, number]> = [];

    // Site layer: one circle+marker per site that has ≥1 active shift.
    const siteAgg = new Map<string, { lat: number; lng: number; radius?: number; name: string; names: string[] }>();
    for (const row of rows) {
      if (row.siteLat === undefined || row.siteLng === undefined) continue;
      const key = `${row.siteLat},${row.siteLng},${row.siteRadiusMeters ?? "?"}`;
      const agg = siteAgg.get(key) ?? {
        lat: row.siteLat,
        lng: row.siteLng,
        radius: row.siteRadiusMeters,
        name: row.siteName ?? "site",
        names: [],
      };
      agg.names.push(row.name);
      siteAgg.set(key, agg);
    }
    for (const site of siteAgg.values()) {
      if (site.radius && site.radius > 0) {
        L.circle([site.lat, site.lng], {
          radius: site.radius,
          color: SITE_COLOR,
          weight: 1.5,
          opacity: 0.9,
          fillColor: SITE_COLOR,
          fillOpacity: 0.07,
        }).addTo(layer);
      }
      L.circleMarker([site.lat, site.lng], {
        radius: 4,
        color: SITE_COLOR,
        fillColor: SITE_COLOR,
        fillOpacity: 0.9,
      })
        .bindPopup(
          popupElement([
            { text: site.name, strong: true },
            { text: `${site.names.length} on shift: ${site.names.join(", ")}` },
          ])
        )
        .addTo(layer);
      points.push([site.lat, site.lng]);
    }

    // Employee layer: pin at latest logged GPS position.
    for (const row of rows) {
      if (!row.lastLog) continue;
      const { lat, lng } = row.lastLog;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const inside = row.lastLog.isWithinGeofence;
      const color = inside ? INSIDE_COLOR : OUTSIDE_COLOR;
      const stale = now - row.lastLog.clientReportedTime > STALE_MS;
      L.circleMarker([lat, lng], {
        radius: 7,
        color: color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2,
      })
        .bindPopup(
          popupElement([
            { text: row.name, strong: true },
            { text: `${row.siteName ?? "no site yet"} · on shift ${formatElapsed(row.startedAt, now)}` },
            { text: `last ping ${formatDateTime(row.lastLog.clientReportedTime, userLocale)} (${row.lastLog.status})` },
            ...(stale ? [{ text: "stale — no ping in 2h+", tone: "warn" as const }] : []),
            { text: inside ? "inside geofence" : "outside geofence", tone: inside ? ("good" as const) : ("bad" as const) },
          ])
        )
        .addTo(layer);
      if (Number.isFinite(row.lastLog.accuracyMeters) && row.lastLog.accuracyMeters > 0) {
        L.circle([lat, lng], {
          radius: row.lastLog.accuracyMeters,
          color: "#94a3b8",
          weight: 1,
          dashArray: "4 4",
          fill: false,
        }).addTo(layer);
      }
      points.push([lat, lng]);
    }

    if (!fittedRef.current && points.length > 0 && mapRef.current) {
      if (points.length === 1) {
        mapRef.current.setView(points[0], 15);
      } else {
        mapRef.current.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
      }
      fittedRef.current = true;
    }
    // rowsKey is the stable serialisation of rows (P1-5 lesson: identity ≠ content).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, rowsKey]);

  const noPing = (rows ?? []).filter((r) => !r.lastLog);

  return (
    <section aria-labelledby="live-crew-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="live-crew-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
          Live crew{rows ? ` (${rows.length})` : ""}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)]" aria-live="polite">
            {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString(userLocale)} · auto 45s` : "loading…"}
          </span>
          <button
            onClick={() => bump({ tables: [...MAP_TABLES] })}
            aria-label="Refresh live crew map"
            className="btn-surgical min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-[var(--cyan)] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
          >
            refresh
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        role="application"
        aria-label="Map of employees currently on shift"
        className="h-80 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-2)]"
      />

      {rows !== undefined && rows.length === 0 && (
        <p className="mt-2 text-sm text-[var(--fog)]">No active shifts right now.</p>
      )}

      {noPing.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          No GPS log yet:{" "}
          {noPing.map((r) => `${r.name} (on shift since ${formatDateTime(r.startedAt, userLocale)})`).join(" · ")}
        </p>
      )}

      <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SITE_COLOR }} />site geofence</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: INSIDE_COLOR }} />inside geofence</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: OUTSIDE_COLOR }} />outside geofence</span>
      </p>
    </section>
  );
}
