"use client";

import { usePagination } from "@/components/console/use-pagination";
import { Pager } from "@/components/console/pager";
import { ConsoleWindow } from "@/components/console/window";
import type { ModeratorEmployee } from "./types";
import { LocaleCell, RateCell, ResetDeviceButton, DeactivateButton } from "./action-cells";

/* ─────────────────────────── Crew (employees) ─────────────────────────── */

export function CrewView({
  employees,
  loading,
  sites,
}: {
  employees: ModeratorEmployee[];
  loading?: boolean;
  sites: { _id: string; name: string }[];
}) {
  const table = usePagination(employees, 7);
  const cards = usePagination(employees, 4);
  const siteNames = (e: ModeratorEmployee) =>
    sites.filter((s) => e.assignedSiteIds?.includes(s._id)).map((s) => s.name).join(", ") || "—";

  return (
    <div role="tabpanel" id="tabpanel-crew" aria-labelledby="tab-crew" aria-label="Crew" className="h-full min-h-0">
      <ConsoleWindow
        title={loading ? "Employees (…)" : `Employees (${employees.length})`}
        className="h-full"
        bodyClassName="flex h-full min-h-0 flex-col p-2 sm:p-3"
      >
        {/* Desktop: dense table */}
        <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Name</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Email</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Sites</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Locale</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Rate/h</th>
                <th scope="col" className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {table.pageItems.map((e: any) => (
                <tr key={e._id} className="border-t border-[var(--line)]/60 transition hover:bg-[var(--panel-elevated)]/40">
                  <td className="px-3 py-2 font-medium text-[var(--paper)]">{e.name ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--fog)]">{e.email}</td>
                  <td className="max-w-[10rem] px-3 py-2 text-[var(--text-secondary)]">{siteNames(e)}</td>
                  <td className={`px-3 py-2 font-semibold ${e.archivedAt ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
                    {e.archivedAt ? "deactivated" : "active"}
                  </td>
                  <td className="px-3 py-2"><LocaleCell userId={e._id} initial={e.locale ?? "en-ZA"} /></td>
                  <td className="px-3 py-2"><RateCell userId={e._id} initial={e.hourlyRateOverride} /></td>
                  <td className="px-3 py-2 text-right">
                    {!e.archivedAt && (
                      <span className="inline-flex gap-2">
                        {e.deviceId && <ResetDeviceButton userId={e._id} />}
                        <DeactivateButton userId={e._id} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile: stacked cards, zero horizontal scroll */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:hidden">
          {cards.pageItems.map((e: any) => (
            <div key={e._id} className="card-subpanel flex-none px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--paper)]">{e.name ?? "—"}</span>
                <span className={`flex-none text-xs font-bold uppercase tracking-wider ${e.archivedAt ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
                  {e.archivedAt ? "deactivated" : "active"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--fog)]">{e.email} · {siteNames(e)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <LocaleCell userId={e._id} initial={e.locale ?? "en-ZA"} />
                <RateCell userId={e._id} initial={e.hourlyRateOverride} />
                {!e.archivedAt && (
                  <span className="ml-auto inline-flex gap-1.5">
                    {e.deviceId && <ResetDeviceButton userId={e._id} />}
                    <DeactivateButton userId={e._id} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <Pager
            page={table.page}
            pageCount={table.pageCount}
            total={table.total}
            onPage={table.setPage}
            label="Employees"
          />
        </div>
        <div className="md:hidden">
          <Pager
            page={cards.page}
            pageCount={cards.pageCount}
            total={cards.total}
            onPage={cards.setPage}
            label="Employees"
          />
        </div>
      </ConsoleWindow>
    </div>
  );
}

