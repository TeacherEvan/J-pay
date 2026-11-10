"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { bump } from "@/lib/backend/react";
import { formatDateTime } from "@/lib/format";
import { ConsoleWindow } from "@/components/console/window";
import { useUserLocale } from "@/lib/use-user-locale";

/**
 * Shared live-crew map — one engine for the moderator and manager consoles
 * (U13 follow-up). Differences are data, not code:
 *  - siteLayer="active"  → circles only for sites with ≥1 active shift (moderator)
 *  - siteLayer="managed" → every managed site drawn, even with nobody on shift
 *  - rows may carry `travel` (manager) — pins render in TRAVEL_COLOR while off-site
 */

export type CrewShiftRow = {
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

export type SiteToDraw = {
  _id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
};

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

export function LiveCrewMap({
  rows,
  managedSites,
  siteLayer,
  mapTables,
  windowId,
  title,
  ariaLabel,
  refreshLabel,
  emptyText,
  footerSegments,
  panHint,
}: {
  rows: CrewShiftRow[] | undefined;
  managedSites?: SiteToDraw[];
  siteLayer: "active" | "managed";
  mapTables: readonly string[];
  windowId?: string;
  title: (count: number | undefined) => string;
  ariaLabel: string;
  refreshLabel: string;
  emptyText: string;
  footerSegments: Array<{ color: string; label: string }>;
  panHint: string;
}) {
  const userLocale = useUserLocale();
  const [L, setL] = useState<typeof LType | null>(null);
  const [mapError, setMapError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const layerRef = useRef<LType.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Leaflet is client-only; import after mount.
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((mod) => {
        if (!cancelled) setL((mod.default ?? mod) as typeof LType);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh via the shared invalidation bus (45s).
  useEffect(() => {
    const t = setInterval(() => bump({ tables: [...mapTables] }), AUTO_REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // afterwards we keep the operator's pan/zoom instead of yanking the map.
  const rowsKey = useMemo(() => JSON.stringify([rows ?? [], managedSites ?? []]), [rows, managedSites]);
  useEffect(() => {
    if (!L || !mapRef.current || !layerRef.current || rows === undefined) return;
    // U10: never yank an open popup out from under the operator on the 45s
    // auto-refresh. Skip this redraw; the next bump re-renders.
    const openPopup = (mapRef.current as unknown as { _popup?: { isOpen?: () => boolean } })._popup;
    if (openPopup && typeof openPopup.isOpen === "function" && openPopup.isOpen()) return;
    const layer = layerRef.current;
    layer.clearLayers();

    const now = Date.now();
    const points: Array<[number, number]> = [];

    if (siteLayer === "managed") {
      // Every managed site drawn, even with nobody on shift — the manager owns this footprint.
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
    } else {
      // Moderator: one circle+marker per site that has ≥1 active shift.
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
    }

    // Employee layer: pin at latest logged GPS position (or travel fix).
    for (const row of rows) {
      if (!row.lastLog) continue;
      const { lat, lng } = row.lastLog;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const travelling = row.travel !== null && row.travel !== undefined;
      const inside = row.lastLog.isWithinGeofence;
      const color = travelling ? TRAVEL_COLOR : inside ? INSIDE_COLOR : OUTSIDE_COLOR;
      const stale = now - row.lastLog.clientReportedTime > STALE_MS;
      const travelMinutes = travelling
        ? Math.max(0, Math.round((now - (row.travel as NonNullable<typeof row.travel>).departedAt) / 60000))
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
    <ConsoleWindow
      id={windowId}
      title={title(rows?.length)}
      className="min-h-0 flex-1"
      bodyClassName="flex min-h-0 flex-col gap-1 p-2"
      aside={
        <>
          <span className="hidden text-xs text-[var(--text-secondary)] sm:inline" aria-live="polite">
            {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString(userLocale)} · auto 45s` : "loading…"}
          </span>
          <button
            onClick={() => bump({ tables: [...mapTables] })}
            aria-label={refreshLabel}
            className="btn-surgical min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-semibold border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
          >
            refresh
          </button>
        </>
      }
    >
      {mapError ? (
        <div className="flex h-full min-h-[180px] w-full flex-1 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm text-[var(--fog)]">
          Map unavailable — check your connection and refresh.
        </div>
      ) : (
        <div
          ref={containerRef}
          role="application"
          aria-label={ariaLabel}
          className="h-full min-h-[180px] w-full flex-1 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]"
        />
      )}

      {rows !== undefined && rows.length === 0 && (
        <p className="flex-none text-xs text-[var(--fog)]">{emptyText}</p>
      )}

      {noPing.length > 0 && (
        <p className="flex-none truncate text-xs text-[var(--text-secondary)]">
          No GPS log yet:{" "}
          {noPing.map((r) => `${r.name} (on shift since ${formatDateTime(r.startedAt, userLocale)})`).join(" · ")}
        </p>
      )}

      <p className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]" aria-hidden="true">
        {footerSegments.map((seg) => (
          <span key={seg.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: seg.color }} />
            {seg.label}
          </span>
        ))}
      </p>
      <p className="sr-only">{panHint}</p>
    </ConsoleWindow>
  );
}
