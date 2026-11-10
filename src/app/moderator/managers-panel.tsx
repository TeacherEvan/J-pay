"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";
import { errMsg } from "@/lib/errors";

/* ─────────────────────────── Managers panel ─────────────────────────── */

export function ManagersPanel({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string | null; email?: string | null; archivedAt?: number; role?: string }[];
  sites: { _id: string; name: string }[];
}) {
  const managers = useQuery(api.manager.listManagers) as
    | { _id: string; name?: string | null; email?: string | null; isActive: boolean; managedSiteIds: string[]; managedSiteNames: string[] }[]
    | undefined;
  const promote = useMutation(api.manager.promoteToManager);
  const demote = useMutation(api.manager.demoteManager);
  const setSites = useMutation(api.manager.setManagerSites);
  const [promoteUserId, setPromoteUserId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const promotable = employees.filter((e) => !e.archivedAt && e.role === "employee");
  const paged = usePagination(managers ?? [], 2);
  const sitePage = usePagination(sites, 4);

  const openEditor = (m: { _id: string; managedSiteIds: string[] }) => {
    setOpenId(m._id);
    setChecked(new Set(m.managedSiteIds));
    setMsg(null);
  };

  return (
    <ConsoleWindow
      title="Managers"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-1.5 p-3"
      aside={<span className="text-xs text-[var(--fog)]">scoped crew access · no payroll rights</span>}
    >
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--line)] pb-2">
        <select value={promoteUserId} onChange={(e) => setPromoteUserId(e.target.value)}
          aria-label="Employee to promote"
          className="input-surgical min-w-0 flex-1 px-3 py-2 text-xs">
          <option value="">Employee to promote…</option>
          {promotable.map((e) => (
            <option key={e._id} value={e._id}>{e.name ?? e.email}</option>
          ))}
        </select>
        <button
          disabled={!promoteUserId}
          onClick={async () => {
            setMsg(null);
            try {
              await promote({ userId: promoteUserId as never });
              setPromoteUserId("");
              setMsg("Promoted to manager.");
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Promote
        </button>
      </div>
      {msg && <p className="flex-none truncate text-xs font-medium text-[var(--paper)]">{msg}</p>}

      <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
        {paged.pageItems.map((m) => (
          <li key={m._id} className="flex-none rounded-lg border border-[var(--line)] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--paper)]">{m.name ?? m.email}</span>
                <span className="block truncate text-xs text-[var(--text-secondary)]">
                  {!m.isActive && <span className="mr-1 font-semibold text-[var(--danger)]">deactivated ·</span>}
                  {m.managedSiteNames.length > 0 ? m.managedSiteNames.join(", ") : "no sites scoped"}
                </span>
              </div>
              <span className="inline-flex flex-none gap-1.5">
                <button
                  onClick={() => (openId === m._id ? setOpenId(null) : openEditor(m))}
                  className="btn-surgical min-h-[44px] px-2.5 py-1.5 text-xs font-semibold border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
                >
                  {openId === m._id ? "Close" : "Sites"}
                </button>
                <button
                  onClick={async () => {
                    setMsg(null);
                    try {
                      await demote({ userId: m._id as never });
                      setMsg("Demoted to employee.");
                    } catch (e) {
                      setMsg(errMsg(e));
                    }
                  }}
                  className="btn-surgical min-h-[44px] px-2.5 py-1.5 text-xs font-semibold border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                >
                  Demote
                </button>
              </span>
            </div>
            {openId === m._id && (
              <div className="mt-1.5 flex flex-col gap-1.5 border-t border-[var(--line)] pt-1.5">
                <div className="flex flex-none flex-col gap-1">
                  {sitePage.pageItems.map((s) => {
                    const on = checked.has(s._id);
                    return (
                      <label key={s._id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
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
                </div>
                <Pager page={sitePage.page} pageCount={sitePage.pageCount} total={sitePage.total} onPage={sitePage.setPage} label="Sites" />
                <button
                  onClick={async () => {
                    setMsg(null);
                    try {
                      const result = await setSites({
                        managerId: m._id as never,
                        siteIds: [...checked] as never,
                      });
                      setMsg(`Saved — manager covers ${result.total} site${result.total === 1 ? "" : "s"}.`);
                    } catch (e) {
                      setMsg(errMsg(e));
                    }
                  }}
                  className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-4 py-2 text-xs font-semibold"
                >
                  Save sites
                </button>
              </div>
            )}
          </li>
        ))}
        {managers !== undefined && managers.length === 0 && (
          <li className="flex-none text-xs text-[var(--fog)]">No managers yet.</li>
        )}
      </ul>
      <Pager page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} label="Managers" />
    </ConsoleWindow>
  );
}

