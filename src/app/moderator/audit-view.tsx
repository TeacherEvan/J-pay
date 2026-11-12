"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { usePagination } from "@/components/console/use-pagination";
import { ReviewPanel } from "../payroll";
import { ShiftOverridePanel } from "./shift-overrides-panel";
import { useOrg, type AuditSegment } from "./org-context";
import { useUserLocale } from "@/lib/use-user-locale";
import { Pager } from "@/components/console/pager";
import { ConsoleWindow } from "@/components/console/window";
import { formatDateTime } from "@/lib/format";
import type { GeofenceFix } from "./geofence-modal";
import type { AuditLogRow } from "./types";

type Flag = "all" | "geofence" | "travel" | "skew";

/* ───────────────────────────── Audit log ───────────────────────────── */

function ActivityLog({
  audit,
  userLocale,
  onMapFix,
  loading,
}: {
  audit: AuditLogRow[];
  userLocale: string;
  onMapFix: (fix: GeofenceFix) => void;
  loading: boolean;
}) {
  const { userFilter, clearUserFilter } = useOrg();
  const [q, setQ] = useState("");
  const [flag, setFlag] = useState<Flag>("all");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return audit.filter(
      (l) =>
        (!userFilter || (l as { userId?: string }).userId === userFilter) &&
        (flag === "all" ||
          (flag === "geofence" && !l.isWithinGeofence) ||
          (flag === "travel" && l.impossibleTravelFlag) ||
          (flag === "skew" && Math.abs(l.clockSkewMs) > 30000)) &&
        (!needle || `${l.employeeName} ${l.siteName} ${l.status}`.toLowerCase().includes(needle)),
    );
  }, [audit, q, flag, userFilter]);
  const chipName = userFilter ? audit.find((l) => (l as { userId?: string }).userId === userFilter)?.employeeName ?? "selected employee" : null;
  const table = usePagination(rows, 7);
  const cards = usePagination(rows, 4);

  const rowActions = (l: AuditLogRow) => (
    <>
      {!l.isWithinGeofence && <span className="mr-1.5 font-semibold text-[var(--danger)]">geofence✗</span>}
      {l.impossibleTravelFlag && <span className="font-semibold text-[var(--danger)]">travel!</span>}
      {l.siteLat !== undefined && l.siteLng !== undefined && (
        <button
          onClick={() =>
            onMapFix({
              employeeName: l.employeeName,
              status: l.status,
              lat: l.lat,
              lng: l.lng,
              accuracyMeters: l.accuracyMeters,
              siteName: l.siteName,
              siteLat: l.siteLat!,
              siteLng: l.siteLng!,
              siteRadius: l.siteRadius ?? 0,
              isWithinGeofence: l.isWithinGeofence,
              impossibleTravelFlag: l.impossibleTravelFlag ?? false,
            })
          }
          aria-label={`Open geofence map for ${l.employeeName} at ${l.siteName}`}
          className="btn-surgical ml-2 rounded border-[var(--cyan)]/40 px-3 py-1 text-xs font-semibold text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
        >
          map
        </button>
      )}
    </>
  );

  return (
    <div role="tabpanel" id="tabpanel-audit" aria-labelledby="tab-audit" aria-label="Audit log" className="h-full min-h-0">
      <ConsoleWindow
        title="Audit log · 7 days"
        className="h-full"
        bodyClassName="flex h-full min-h-0 flex-col p-2 sm:p-3"
        aside={
          <span className="text-xs text-[var(--fog)]">{loading ? "Loading…" : `${rows.length} rows`}</span>
        }
      >
        <div className="mb-2 flex flex-none flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee, site, status…"
            aria-label="Search audit log"
            className="input-surgical min-w-[12rem] flex-1 px-3 py-1.5 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by flag">
            {(["all", "geofence", "travel", "skew"] as Flag[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFlag(f)}
                aria-pressed={flag === f}
                className={`btn-surgical min-h-[36px] px-2.5 py-1 text-xs font-semibold ${
                  flag === f ? "border-[var(--mint)] text-[var(--mint)] bg-[var(--mint)]/10" : "text-[var(--fog)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {chipName && (
            <button
              type="button"
              onClick={clearUserFilter}
              className="btn-surgical inline-flex min-h-[36px] items-center gap-1.5 border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--cyan)]"
            >
              <span>{chipName}</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        {/* Desktop table */}
        <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Time (client)</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Employee</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Site</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">±m</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Skew</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Flags</th>
              </tr>
            </thead>
            <tbody>
              {table.pageItems.map((l) => (
                <tr key={l._id} className="border-t border-[var(--line)]/60 transition hover:bg-[var(--panel-elevated)]/40">
                  <td className="tnum px-3 py-2 font-medium text-[var(--paper)]">{formatDateTime(l.at, userLocale)}</td>
                  <td className="px-3 py-2 font-medium">{l.employeeName}</td>
                  <td className="px-3 py-2 text-[var(--fog)]">{l.siteName}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{l.status}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--fog)]">{l.accuracyMeters}</td>
                  <td className={`tnum px-3 py-2 text-right ${(Math.abs(l.clockSkewMs) > 30000) ? "font-semibold text-[var(--hivis)]" : "text-[var(--fog)]"}`}>
                    {Math.round(l.clockSkewMs / 1000)}s
                  </td>
                  <td className="px-3 py-2">{rowActions(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:hidden">
          {cards.pageItems.map((l) => (
            <div key={l._id} className="card-subpanel flex-none px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tnum font-semibold text-[var(--paper)]">{formatDateTime(l.at, userLocale)}</span>
                <span className="truncate font-medium text-[var(--text-secondary)]">{l.employeeName}</span>
              </div>
              <p className="mt-0.5 truncate text-[var(--fog)]">{l.siteName} · {l.status} · ±{l.accuracyMeters}m · skew {Math.round(l.clockSkewMs / 1000)}s</p>
              <div className="mt-1">{rowActions(l)}</div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <Pager page={table.page} pageCount={table.pageCount} total={table.total} onPage={table.setPage} label="Audit rows" />
        </div>
        <div className="md:hidden">
          <Pager page={cards.page} pageCount={cards.pageCount} total={cards.total} onPage={cards.setPage} label="Audit rows" />
        </div>
      </ConsoleWindow>
    </div>
  );
}

export function AuditView({
  audit,
  reviewCount,
  userLocale,
  onMapFix,
}: {
  audit: AuditLogRow[];
  reviewCount: number;
  userLocale: string;
  onMapFix: (fix: GeofenceFix) => void;
}) {
  const { auditSegment, goto } = useOrg();
  const segments: { id: AuditSegment; label: string; badge?: number }[] = [
    { id: "activity", label: "Activity log" },
    { id: "review", label: "Needs review", badge: reviewCount > 0 ? reviewCount : undefined },
    { id: "corrections", label: "Shift corrections" },
  ];

  return (
    <div role="tabpanel" id="tabpanel-audit" aria-labelledby="tab-audit" aria-label="Audit" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-none flex-wrap items-center gap-1.5" role="tablist" aria-label="Audit section">
        {segments.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={auditSegment === s.id}
            onClick={() => goto("audit", { auditSegment: s.id })}
            className={`btn-surgical min-h-[40px] px-3 py-1.5 text-xs font-semibold ${
              auditSegment === s.id
                ? "border-[var(--mint)] bg-[var(--mint)]/10 text-[var(--mint)]"
                : "text-[var(--fog)] hover:text-[var(--paper)]"
            }`}
          >
            <span>{s.label}</span>
            {s.badge !== undefined && (
              <span className="ml-1.5 rounded-full bg-[var(--danger)]/20 px-1.5 py-0.5 text-xs font-bold text-[var(--danger)]">
                {s.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {auditSegment === "activity" && (
          <ActivityLog audit={audit} userLocale={userLocale} onMapFix={onMapFix} loading={false} />
        )}
        {auditSegment === "review" && <ReviewPanel className="h-full" />}
        {auditSegment === "corrections" && <ShiftOverridePanel />}
      </div>
    </div>
  );
}

