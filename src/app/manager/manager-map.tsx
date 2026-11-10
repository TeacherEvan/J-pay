"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { bump, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";

type ManagedShiftRow = {
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
  travel?: {
    segmentId: string;
    departedAt: number;
    distanceMeters: number;
    maxSpeedMps?: number;
    sampleCount: number;
    speedMps?: number;
  } | null;
};

type ManagedSite = {
  _id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
};

const MAP_TABLES = ["shifts", "logs", "users", "sites", "managerSites", "userSites", "travelSegments"] as const;
const AUTO_REFRESH_MS = 45_000;
const STALE_MS = 2 * 60 * 60 * 1000;

const SITE_COLOR = "#22d3ee";
const INSIDE_COLOR = "#34d399";
const OUTSIDE_COLOR = "#f87171";
const TRAVEL_COLOR = "#fbbf24";

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

export function ManagerMap() {
  const rows = useQuery(api.manager.managedActiveShifts, {}) as ManagedShiftRow[] | undefined;
  const managedSites = useQuery(api.manager.listManagedSites, {}) as ManagedSite[] | undefined;
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

  // Auto-refresh via the shared invalidation bus (45s). Scoped manager
  // surfaces only — does not nudge moderator panels.
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
  // afterwards we keep the manager's pan/zoom instead of yanking the map.
  const rowsKey = useMemo(() => JSON.stringify([rows ?? [], managedSites ?? []]), [rows, managedSites]);
  useEffect(() => {
    if (!L || !mapRef.current || !layerRef.current || rows === undefined) return;
    const layer = layerRef.current;
    layer.clearLayers();

    const now = Date.now();
    const points: Array<[number, number]> = [];

    // Managed sites: every assigned site gets a geofence circle, even with no
    // one on shift — the manager owns this footprint.
    for (const site of managedSites ?? []) {
      if (site.geofenceRadiusMeters > 0) {
        L.circle([site.latitude, site.longitude], {
          radius: site.geofenceRadiusMeters,
          color: SITE_COLOR,
          weight: 1.5,
          opacity: 0.9,
          fillColor: SITE_COLOR,
          fillOpacity: 0.07,
        }).addTo(layer);
      }
      L.circleMarker([site.latitude, site.longitude], {
        radius: 4,
        color: SITE_COLOR,
        fillColor: SITE_COLOR,
        fillOpacity: 0.9,
      })
        .bindPopup(popupElement([{ text: site.name, strong: true }]))
        .addTo(layer);
      points.push([site.latitude, site.longitude]);
    }

    // Employee layer: pin at latest position — travel fixes while off-site,
    // else the employee's last check-in/checkpoint log.
    for (const row of rows) {
      if (!row.lastLog) continue;
      const { lat, lng } = row.lastLog;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const travelling = row.travel !== null && row.travel !== undefined;
      const inside = row.lastLog.isWithinGeofence;
      const color = travelling ? TRAVEL_COLOR : inside ? INSIDE_COLOR : OUTSIDE_COLOR;
      const stale = now - row.lastLog.clientReportedTime > STALE_MS;
      const travelMinutes = travelling
        ? Math.max(0, Math.round(((row.travel as NonNullable<typeof row.travel>).departedAt ? now - (row.travel as NonNullable<typeof row.travel>).departedAt : 0) / 60000))
        : 0;
      const travelKm = travelling
        ? ((row.travel as NonNullable<typeof row.travel>).distanceMeters / 1000).toFixed(1)
        : null;
      const topSpeed = travelling && row.travel?.maxSpeedMps
        ? Math.round(row.travel.maxSpeedMps * 3.6)
        : null;
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
            travelling
              ? { text: `travelling · ${travelKm} km · ${travelMinutes} min · top ${topSpeed ?? 0} km/h`, strong: true, tone: "warn" as const }
              : { text: `${row.siteName ?? "off-site"} · on shift ${formatElapsed(row.startedAt, now)}` },
            { text: `last ping ${formatDateTime(row.lastLog.clientReportedTime, userLocale)} (${row.lastLog.status})` },
            ...(stale ? [{ text: "stale — no ping in 2h+", tone: "warn" as const }] : []),
            {
              text: travelling ? "travelling to a site" : inside ? "inside geofence" : "off-site",
              tone: travelling ? ("warn" as const) : inside ? ("good" as const) : ("bad" as const),
            },
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
    <section aria-labelledby="manager-map-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="manager-map-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
          My crew on site{rows ? ` (${rows.length})` : ""}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)]" aria-live="polite">
            {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString(userLocale)} · auto 45s` : "loading…"}
          </span>
          <button
            onClick={() => bump({ tables: [...MAP_TABLES] })}
            aria-label="Refresh manager map"
            className="btn-surgical min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-semibold text-[var(--cyan)] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
          >
            refresh
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        role="application"
        aria-label="Map of crew assigned to your sites currently on shift"
        className="h-80 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-2)]"
      />

      {rows !== undefined && rows.length === 0 && (
        <p className="mt-2 text-sm text-[var(--fog)]">No crew on shift right now.</p>
      )}

      {noPing.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          No GPS log yet:{" "}
          {noPing.map((r) => `${r.name} (on shift since ${formatDateTime(r.startedAt, userLocale)})`).join(" · ")}
        </p>
      )}

      <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SITE_COLOR }} />managed geofence</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: INSIDE_COLOR }} />inside geofence</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TRAVEL_COLOR }} />travelling (on-shift, off-site)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: OUTSIDE_COLOR }} />off-site, no travel fixes</span>
      </p>
    </section>
  );
}
