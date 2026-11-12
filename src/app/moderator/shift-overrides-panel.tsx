"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";
import { errMsg } from "@/lib/errors";
import { useUserLocale } from "@/lib/use-user-locale";
import { formatDateTime } from "@/lib/format";
import { useOrg } from "./org-context";

/* ─────────────────────────── Shift overrides ─────────────────────────── */

export type OverridableShift = {
  _id: string;
  employeeName: string;
  startedAt: number;
  endedAt?: number;
  totalMinutes?: number;
  needsReview: boolean;
  reviewReason?: string;
  hasOverride: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export function ShiftOverridePanel() {
  const { orgId, userFilter } = useOrg();
  const allShifts = useQuery(api.moderator.overridableShifts, orgId ? { orgId } : "skip") as (OverridableShift & { userId?: string })[] | undefined;
  const shifts = allShifts && userFilter ? allShifts.filter((r) => r.userId === userFilter) : allShifts;
  const override = useMutation(api.moderator.endShiftOverride);
  const userLocale = useUserLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = usePagination(shifts ?? [], 3);

  const openEditor = (row: OverridableShift) => {
    setOpenId(row._id);
    setWhen(toLocalInput(row.endedAt ?? row.startedAt + 8 * 3600 * 1000));
    setReason("");
    setMsg(null);
  };

  return (
    <ConsoleWindow
      title="Shift overrides · forgotten log-off"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-1.5 p-3"
      aside={<span className="hidden text-xs text-[var(--fog)] sm:inline">reason required · audited</span>}
    >
      {shifts === undefined && <p className="flex-none text-xs text-[var(--fog)]">Loading…</p>}
      {shifts !== undefined && shifts.length === 0 && (
        <p className="flex-none text-xs text-[var(--fog)]">No unsealed shifts in the last 14 days.</p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
        {list.pageItems.map((row) => (
          <li key={row._id} className="flex-none rounded-lg border border-[var(--line)] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-xs">
                <span className="font-medium text-[var(--paper)]">{row.employeeName}</span>
                <span className="ml-2 tnum text-xs text-[var(--text-secondary)]">
                  {formatDateTime(row.startedAt, userLocale)} →{" "}
                  {row.endedAt ? formatDateTime(row.endedAt, userLocale) : "open"}
                </span>
                {row.needsReview && (
                  <span className="ml-2 rounded-full border border-[var(--hivis)]/40 px-1.5 py-0.5 text-xs text-[var(--hivis)]">
                    {row.hasOverride ? "overridden" : "needs review"}
                  </span>
                )}
                {!row.endedAt && (
                  <span className="ml-2 rounded-full border border-[var(--mint)]/40 px-1.5 py-0.5 text-xs text-[var(--mint)]">forgot log-off?</span>
                )}
              </div>
              <button
                onClick={() => (openId === row._id ? setOpenId(null) : openEditor(row))}
                className="btn-surgical min-h-[44px] flex-none px-2.5 py-1.5 text-xs font-semibold border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
              >
                {openId === row._id ? "Close" : "Override end"}
              </button>
            </div>
            {openId === row._id && (
              <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-[var(--line)] p-2">
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Corrected end (local time)
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="input-surgical px-3 py-1.5 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Reason (required, min 10 characters) — audited
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Employee called in — forgot to log off, left site at 17:30"
                    className="input-surgical px-3 py-1.5 text-xs"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={busy || !when || reason.trim().length < 10}
                    onClick={async () => {
                      setBusy(true);
                      setMsg(null);
                      try {
                        await override({
                          shiftId: row._id as never,
                          endedAt: new Date(when).getTime(),
                          reason: reason.trim(),
                        });
                        setMsg("Override saved — shift re-derives, payroll reflects the change.");
                      } catch (e) {
                        setMsg(errMsg(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Save override"}
                  </button>
                  {msg && <span className="min-w-0 truncate text-xs font-medium text-[var(--paper)]">{msg}</span>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pager page={list.page} pageCount={list.pageCount} total={list.total} onPage={list.setPage} label="Shifts" />
    </ConsoleWindow>
  );
}

