"use client";

import { useState } from "react";
import { useMutation } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";
import { errMsg } from "@/lib/errors";

/* ─────────────────────────── Assign panel ─────────────────────────── */

export function AssignPanel({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string | null; email?: string | null; archivedAt?: number; assignedSiteIds?: string[]; role?: string }[];
  sites: { _id: string; name: string }[];
}) {
  const setAssignments = useMutation(api.sites.setEmployeeSites);
  const [userId, setUserId] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const active = employees.filter((e) => !e.archivedAt);
  const sitePage = usePagination(sites, 5);

  // Initialize the checklist from the employee's current assignments.
  const applySelection = (nextUserId: string) => {
    setUserId(nextUserId);
    setMsg(null);
    const emp = employees.find((e) => e._id === nextUserId);
    setChecked(new Set(emp?.assignedSiteIds ?? []));
  };

  return (
    <ConsoleWindow title="Assign employee ↔ sites" className="h-full" bodyClassName="flex min-h-0 flex-col gap-2 p-3">
      <select value={userId} onChange={(e) => applySelection(e.target.value)}
        aria-label="Employee to assign"
        className="input-surgical w-full flex-none px-3.5 py-2 text-sm">
        <option value="">Employee…</option>
        {active.map((e: any) => (
          <option key={e._id} value={e._id}>{e.name ?? e.email}{e.role === "manager" ? " (manager)" : ""}</option>
        ))}
      </select>
      {userId && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          {sites.length === 0 && <p className="p-2 text-xs text-[var(--fog)]">No sites yet.</p>}
          {sitePage.pageItems.map((s: any) => {
            const on = checked.has(s._id);
            return (
              <label key={s._id} className="flex min-h-[44px] flex-none cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--mint)]"
                  checked={on}
                  onChange={() => {
                    const next = new Set(checked);
                    if (on) next.delete(s._id); else next.add(s._id);
                    setChecked(next);
                  }}
                />
                <span className="truncate">{s.name}</span>
              </label>
            );
          })}
          <Pager page={sitePage.page} pageCount={sitePage.pageCount} total={sitePage.total} onPage={sitePage.setPage} label="Sites" />
        </div>
      )}
      <div className="flex flex-none items-center gap-2.5">
        <button
          disabled={!userId}
          onClick={async () => {
            setMsg(null);
            try {
              const result = await setAssignments({
                userId: userId as never,
                siteIds: [...checked] as never,
              });
              setMsg(`Saved — ${result.total} site${result.total === 1 ? "" : "s"} assigned (+${result.assigned} / −${result.unassigned}).`);
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save assignments
        </button>
      </div>
      {msg && <p className="flex-none truncate text-xs font-medium text-[var(--paper)]">{msg}</p>}
    </ConsoleWindow>
  );
}

