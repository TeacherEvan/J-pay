"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { CrewShiftRow } from "@/components/console/live-crew-map";
import { ConsoleWindow } from "@/components/console/window";
import { KpiBanner } from "./kpi-banner";
import { ActiveShiftsMap } from "./active-shifts-map";
import { useOrg } from "./org-context";
import type { ModeratorEmployee } from "./types";

type Status = "on-site" | "off-site" | "no-gps" | "off-shift";
const CHIP: Record<Status, { label: string; cls: string }> = {
  "on-site": { label: "on site", cls: "text-[var(--mint)] border-[var(--mint)]/40" },
  "off-site": { label: "off site", cls: "text-[var(--danger)] border-[var(--danger)]/40" },
  "no-gps": { label: "no GPS", cls: "text-[var(--hivis)] border-[var(--hivis)]/40" },
  "off-shift": { label: "off shift", cls: "text-[var(--fog)] border-[var(--line)]" },
};

/**
 * Live = map + roster of EVERYONE in the selected organisation. Selecting a row
 * or a pin opens the shared employee drawer — that is how you act on one person.
 */
export function LiveView({ employees }: { employees: ModeratorEmployee[] }) {
  const { orgId, focusUserId, openUser } = useOrg();
  const rows = useQuery(api.moderator.activeShifts, orgId ? { orgId } : "skip") as CrewShiftRow[] | undefined;
  const [q, setQ] = useState("");
  const [onlyOnShift, setOnlyOnShift] = useState(false);

  const byUser = useMemo(() => new Map((rows ?? []).map((r) => [r.userId, r])), [rows]);
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees
      .filter((e) => e.archivedAt === undefined)
      .map((e) => {
        const shift = byUser.get(e._id);
        const status: Status = !shift ? "off-shift" : !shift.lastLog ? "no-gps" : shift.lastLog.isWithinGeofence ? "on-site" : "off-site";
        return { e, shift, status };
      })
      .filter((p) => (!onlyOnShift || p.shift) && (!needle || `${p.e.name ?? ""} ${p.e.email ?? ""}`.toLowerCase().includes(needle)))
      // on-shift people first, then by name
      .sort((a, b) => Number(!!b.shift) - Number(!!a.shift) || String(a.e.name ?? a.e.email).localeCompare(String(b.e.name ?? b.e.email)));
  }, [employees, byUser, q, onlyOnShift]);

  return (
    <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live" aria-label="Live" className="flex h-full min-h-0 flex-col gap-2">
      <KpiBanner />
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        <div className="flex min-h-[260px] min-w-0 flex-1 flex-col">
          <ActiveShiftsMap rows={rows} selectedUserId={focusUserId} onSelectUser={openUser} />
        </div>
        <ConsoleWindow
          title={`Crew · ${people.length}`}
          className="max-h-[40vh] md:max-h-none md:w-80 md:flex-none"
          bodyClassName="flex min-h-0 flex-col gap-1.5 p-2"
        >
          <div className="flex flex-none gap-1.5">
            <label className="sr-only" htmlFor="live-search">Search crew</label>
            <input
              id="live-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              className="input-surgical min-w-0 flex-1 px-3 py-2 text-xs"
            />
            <button
              aria-pressed={onlyOnShift}
              onClick={() => setOnlyOnShift(!onlyOnShift)}
              className={`btn-surgical pill-surgical px-3 text-xs font-semibold ${onlyOnShift ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--mint)]" : "text-[var(--fog)]"}`}
            >
              on shift
            </button>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-testid="live-roster">
            {employees.length === 0 && (
              <li className="p-2 text-xs text-[var(--fog)]">No one in this organisation yet — add people under Access → Provision.</li>
            )}
            {people.map(({ e, shift, status }) => (
              <li key={e._id}>
                <button
                  onClick={() => openUser(e._id)}
                  aria-pressed={focusUserId === e._id}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition hover:bg-[var(--panel-elevated)]/50 ${focusUserId === e._id ? "border-[var(--mint)]/60 bg-[var(--mint)]/10" : "border-[var(--line)]"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--paper)]">{e.name ?? e.email}</span>
                    <span className="block truncate text-xs text-[var(--fog)]">
                      {e.role === "manager" ? "manager · " : ""}
                      {shift?.siteName ?? e.siteNames?.join(", ") ?? ""}
                    </span>
                  </span>
                  <span className={`flex-none rounded-full border px-2 py-0.5 text-xs font-semibold ${CHIP[status].cls}`}>{CHIP[status].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </ConsoleWindow>
      </div>
    </div>
  );
}
