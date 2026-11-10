"use client";

import { usePagination } from "@/components/console/use-pagination";
import { Pager } from "@/components/console/pager";
import { ConsoleWindow } from "@/components/console/window";
import { formatDateTime } from "@/lib/format";
import type { GeofenceFix } from "./geofence-modal";
import type { AuditLogRow } from "./types";

/* ───────────────────────────── Audit log ───────────────────────────── */

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
  const table = usePagination(audit, 7);
  const cards = usePagination(audit, 4);

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
          reviewCount > 0 ? (
            <span
              role="status"
              aria-live="polite"
              className="rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]"
            >
              {reviewCount} need review
            </span>
          ) : undefined
        }
      >
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

