"use client";

import { useQuery } from "@/lib/backend/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/backend/api";
import { phaseOf, type CardLog } from "../check-in/types";
import { ChangePassword, ForcedPasswordChange } from "../change-password";
import { ManagerMap } from "./manager-map";
import { ManagerMessagesPanel } from "./messages-panel";
import { ConsoleWindow } from "@/components/console/window";
import { ConsoleTabs } from "@/components/console/console-tabs";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";

type CrewRow = {
  _id: string;
  name: string;
  email?: string;
  role: "employee" | "manager";
  assignedSiteNames: string[];
  onShift: { _id: string; startedAt: number } | null;
};
type SiteRow = { _id: string; name: string };
type TravelRow = {
  _id: string;
  employeeName: string;
  departedAt: number;
  arrivedAt?: number;
  distanceMeters: number;
  maxSpeedMps?: number;
  sampleCount: number;
  needsReview: boolean;
  reviewReason?: string;
  fromSiteName?: string;
  toSiteName?: string;
};
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";

type ViewId = "live" | "crew" | "messages";

export default function ManagerPage() {
  const me = useQuery(api.users_queries.me);
  // Employee/manager self-shift phase is derived from the caller's own punch logs
  // (convex/shifts.ts only exports internal derivation mutations; CheckInCard uses logs:listMine).
  const myLogs = useQuery(api.logs.listMine, me?.role === "manager" ? {} : "skip") as CardLog[] | null | undefined;
  const crew = useQuery(api.manager.myCrew, {}) as CrewRow[] | undefined;
  const managedSites = useQuery(api.manager.listManagedSites, {}) as SiteRow[] | undefined;
  const travel = useQuery(api.travel.recentForCrew, { limit: 25 }) as TravelRow[] | undefined;
  const userLocale = useUserLocale();
  const latestLog = useMemo(() => {
    if (!Array.isArray(myLogs) || myLogs.length === 0) return undefined;
    return [...myLogs].sort(
      (a, b) =>
        (b.clientReportedTime ?? b._creationTime) - (a.clientReportedTime ?? a._creationTime) ||
        b._creationTime - a._creationTime
    )[0];
  }, [myLogs]);
  const myPhase = phaseOf(latestLog);
  // Ticking clock for elapsed-time displays: a mount-stable Date.now() would
  // freeze in-transit legs at 0 min for the whole session. 30 s cadence keeps
  // re-renders modest; cleared on unmount.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [view, setView] = useState<ViewId>("live");
  const travelPages = usePagination(travel ?? [], 3);
  const crewTable = usePagination(crew ?? [], 6);
  const crewCards = usePagination(crew ?? [], 4);
  const sitePages = usePagination(managedSites ?? [], 8);

  if (me === undefined) {
    return (
      <main className="grid h-dvh place-items-center text-sm text-[var(--fog)]">
        <div className="flex flex-col items-center gap-3">
          <svg className="jpay-loader-emblem h-10 w-10 text-[var(--mint)]" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 4" />
            <circle cx="20" cy="20" r="6" fill="currentColor" />
          </svg>
          <span>Loading…</span>
        </div>
      </main>
    );
  }
  if (me !== null && me !== undefined && me.passwordChangedAt === undefined) {
    return <ForcedPasswordChange />;
  }
  if (me === null || me.role !== "manager") {
    return (
      <main className="grid h-dvh place-items-center p-6 text-center text-sm text-[var(--fog)]">
        <div>
          <p>Manager access only.</p>
          <Link href="/" className="mt-2 inline-block text-[var(--mint)] underline hover:brightness-110">
            Back to check-in
          </Link>
        </div>
      </main>
    );
  }

  const onShiftCount = (crew ?? []).filter((c) => c.onShift).length;
  const tabs = [
    { id: "live", label: "Live map" },
    { id: "crew", label: `Crew (${(crew ?? []).length})` },
    { id: "messages", label: "Messages" },
  ];

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--ink)] md:h-dvh md:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--hivis)]">
            J-Pay · Manager Ops
          </p>
          <h1 className="text-lg font-bold leading-tight tracking-tight text-[var(--paper)] sm:text-xl">
            Manager console
          </h1>
          <p className="hidden truncate text-xs text-[var(--text-secondary)] min-[480px]:block">
            Scoped to your sites · live travel &amp; on-site status
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center text-xs text-[var(--fog)] underline hover:text-[var(--paper)]"
          >
            ← check-in
          </Link>
          {Array.isArray(myLogs) && (
            <Link
              href="/"
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:brightness-110 ${
                myPhase === "on"
                  ? "border-[var(--mint)]/50 bg-[var(--mint)]/12 text-[var(--mint)]"
                  : myPhase === "break"
                    ? "border-[var(--hivis)]/50 bg-[var(--hivis)]/12 text-[var(--hivis)]"
                    : "border-[var(--line)] bg-[var(--panel)] text-[var(--fog)] hover:text-[var(--paper)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  myPhase === "on"
                    ? "bg-[var(--mint)]"
                    : myPhase === "break"
                      ? "bg-[var(--hivis)]"
                      : "bg-[var(--fog)]/60"
                }`}
              />
              {myPhase === "on" ? "You: on shift" : myPhase === "break" ? "You: on break" : "You: off shift"}
            </Link>
          )}
          <ChangePassword />
        </div>
      </header>

      <ConsoleTabs
        tabs={tabs}
        active={view}
        onChange={(id) => setView(id as ViewId)}
        ariaLabel="Manager console view"
      />

      <div className="p-2 sm:p-3 md:min-h-0 md:flex-1">
        {view === "live" && (
          <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live" aria-label="Live map and travel log" className="flex h-full min-h-0 flex-col gap-2">
            <ManagerMap />
            <ConsoleWindow
              title="Travel log · 25 newest legs"
              className="flex-none"
              bodyClassName="flex flex-col gap-0 p-2"
            >
              {travel !== undefined && travel.length === 0 && (
                <p className="py-1 text-xs text-[var(--fog)]">No travel recorded yet. Legs open when a consented employee leaves an assigned site on shift.</p>
              )}
              <ul className="flex flex-col divide-y divide-[var(--line)]">
                {travelPages.pageItems.map((leg) => {
                  const end = leg.arrivedAt ?? nowMs;
                  const mins = Math.max(0, Math.round((end - leg.departedAt) / 60000));
                  const km = (leg.distanceMeters / 1000).toFixed(1);
                  const open = leg.arrivedAt === undefined;
                  return (
                    <li key={leg._id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0 text-xs">
                        <span className="font-medium text-[var(--paper)]">{leg.employeeName}</span>
                        <span className="ml-1.5 text-xs text-[var(--text-secondary)]">
                          {leg.fromSiteName ?? "off-site"} → {open ? "in transit" : leg.toSiteName ?? "off-site"}
                        </span>
                        {leg.needsReview && (
                          <span className="ml-1.5 rounded-full border border-[var(--danger)]/40 px-1.5 py-0.5 text-xs font-semibold text-[var(--danger)]">
                            review: {leg.reviewReason ?? "flagged"}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
                        {open && <span className="font-semibold text-[var(--hivis)]">in transit</span>}
                        <span>{formatDateTime(leg.departedAt, userLocale)}{leg.arrivedAt ? ` → ${formatDateTime(leg.arrivedAt, userLocale)}` : ""}</span>
                        <span>{mins} min</span>
                        <span>{km} km</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pager page={travelPages.page} pageCount={travelPages.pageCount} total={travelPages.total} onPage={travelPages.setPage} label="Legs" />
            </ConsoleWindow>
          </div>
        )}

        {view === "crew" && (
          <div role="tabpanel" id="tabpanel-crew" aria-labelledby="tab-crew" aria-label="Sites and crew" className="flex h-full min-h-0 flex-col gap-2">
            <ConsoleWindow
              title={`My sites (${(managedSites ?? []).length}) · crew of ${(crew ?? []).length} · ${onShiftCount} on shift`}
              className="flex-none"
              bodyClassName="p-2"
            >
              {managedSites !== undefined && managedSites.length === 0 && (
                <p className="text-xs text-[var(--fog)]">
                  No sites assigned to you yet — ask your moderator to scope you to sites.
                </p>
              )}
              <ul className="grid grid-cols-2 gap-1.5 min-[480px]:grid-cols-4">
                {sitePages.pageItems.map((s) => (
                  <li key={s._id} className="truncate rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--paper)]">
                    {s.name}
                  </li>
                ))}
              </ul>
              <Pager page={sitePages.page} pageCount={sitePages.pageCount} total={sitePages.total} onPage={sitePages.setPage} label="Sites" />
            </ConsoleWindow>

            <ConsoleWindow
              title="Crew roster"
              className="min-h-0 flex-1"
              bodyClassName="flex h-full min-h-0 flex-col p-2"
            >
              {/* Desktop table */}
              <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] md:block">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Name</th>
                      <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Sites</th>
                      <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crewTable.pageItems.map((c) => (
                      <tr key={c._id} className="border-t border-[var(--line)]/60">
                        <td className="px-3 py-2 font-medium text-[var(--paper)]">
                          {c.name}
                          {c.role === "manager" && (
                            <span className="ml-2 rounded-full border border-[var(--cyan)]/40 px-1.5 py-0.5 text-xs uppercase tracking-wider text-[var(--cyan)]">manager</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{c.assignedSiteNames.join(", ") || "—"}</td>
                        <td className="px-3 py-2">
                          {c.onShift ? (
                            <span className="text-[var(--mint)]">on shift since {formatDateTime(c.onShift.startedAt, userLocale)}</span>
                          ) : (
                            <span className="text-[var(--fog)]">off shift</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {crew !== undefined && crew.length === 0 && (
                      <tr><td colSpan={3} className="p-4 text-center text-[var(--fog)]">No crew on your sites yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:hidden">
                {crewCards.pageItems.map((c) => (
                  <div key={c._id} className="card-subpanel flex-none px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-[var(--paper)]">
                        {c.name}
                        {c.role === "manager" && (
                          <span className="ml-1.5 rounded-full border border-[var(--cyan)]/40 px-1.5 py-0.5 align-middle text-xs uppercase tracking-wider text-[var(--cyan)]">manager</span>
                        )}
                      </span>
                      {c.onShift ? (
                        <span className="flex-none text-xs font-semibold text-[var(--mint)]">on shift</span>
                      ) : (
                        <span className="flex-none text-xs text-[var(--fog)]">off shift</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{c.assignedSiteNames.join(", ") || "—"}</p>
                    {c.onShift && (
                      <p className="tnum text-xs text-[var(--fog)]">since {formatDateTime(c.onShift.startedAt, userLocale)}</p>
                    )}
                  </div>
                ))}
                {crew !== undefined && crew.length === 0 && (
                  <p className="p-2 text-xs text-[var(--fog)]">No crew on your sites yet.</p>
                )}
              </div>
              <div className="hidden md:block">
                <Pager page={crewTable.page} pageCount={crewTable.pageCount} total={crewTable.total} onPage={crewTable.setPage} label="Crew" />
              </div>
              <div className="md:hidden">
                <Pager page={crewCards.page} pageCount={crewCards.pageCount} total={crewCards.total} onPage={crewCards.setPage} label="Crew" />
              </div>
            </ConsoleWindow>
          </div>
        )}

        {view === "messages" && (
          <div role="tabpanel" id="tabpanel-messages" aria-labelledby="tab-messages" aria-label="Messages" className="h-full min-h-0">
            <ManagerMessagesPanel />
          </div>
        )}
      </div>
    </main>
  );
}
