"use client";

import { useAction, useMutation, useQuery, useQueryResult } from "@/lib/backend/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCurrency, formatDateTime, browserLocale } from "../lib/format";
import { errMsg } from "../lib/errors";
import { useUserLocale } from "../lib/use-user-locale";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
import { QueryError } from "@/components/console/query-error";
import { usePagination } from "@/components/console/use-pagination";
import { useOrg } from "./moderator/org-context";

type PayrollResult = {
  rate: number;
  currency: string;
  strategy: string;
  locale?: string;
  timezone: string;
  days: { day: string; minutes: number; pay: number }[];
  totals: { payableMinutes: number; pay: number; shiftCount: number; flaggedCount: number };
  flagged: { startedAt: number; reason?: string; minutes?: number }[];
};

type SupportedStrategy = {
  code: string;
  strategy: string;
  currency: string;
  currencySymbol: string;
  displayName: string;
};

type OrgPayrollRow = {
  userId: Id<"users">;
  name?: string | null;
  email?: string | null;
  role: string;
  status: "ok" | "no_rate" | "error";
  rate?: number;
  currency?: string;
  locale?: string;
  strategy?: string;
  payableMinutes?: number;
  pay?: number;
  shiftCount?: number;
  flaggedCount?: number;
  error?: string;
};

export function PayrollPanel({ employees, role, className }: { employees: { _id: Id<"users">; orgId?: string; name?: string | null; email?: string | null; archivedAt?: number; locale?: string }[]; role?: "moderator" | "employee"; className?: string }) {
  const { orgId, userFilter } = useOrg();
  const isModerator = role === "moderator";
  const [userId, setUserId] = useState<string>(userFilter ?? "");
  useEffect(() => {
    if (userFilter) setUserId(userFilter);
  }, [userFilter]);
  // ISO-week-aligned periods (1/2/4 weeks, Mon–Sun). A rolling N-day window straddles
  // two ISO weeks, resetting the BCEA weekly overtime cap for each half and erasing
  // statutory OT the worker already earned (audit 2026-11-11, P1-B1). No free-form
  // window is offered anymore: every selectable period is complete ISO weeks, so the
  // 45h/week cap is always consumed correctly.
  const [weeks, setWeeks] = useState<1 | 2 | 4>(1);
  const [weekOffset, setWeekOffset] = useState(0);
  const active = employees.filter(
    (e) => !e.archivedAt && (!isModerator || !orgId || !e.orgId || e.orgId === orgId),
  );
  // Re-anchor at local midnight so an open panel never drifts stale across days.
  const dayKey = new Date().toDateString();
  const monday = useMemo(
    () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      // Monday=0..Sunday=6 (getDay: Sunday=0)
      const base = (d.getDay() + 6) % 7 === 0 ? d.getTime() : d.getTime() - ((d.getDay() + 6) % 7) * 24 * 3600 * 1000;
      const shifted = new Date(base);
      shifted.setDate(shifted.getDate() + weekOffset * 7);
      return shifted.getTime();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayKey, weekOffset],
  );
  const fromMs = monday;
  const toMs = useMemo(
    () => {
      const d = new Date(monday);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + weeks * 7);
      // End-exclusive is not supported by the API; use the last ms of the last day.
      return d.getTime() - 1;
    },
    [monday, weeks],
  );
  const periodLabel = useMemo(() => {
    const fmt = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(fromMs)} – ${fmt(toMs)}`;
  }, [fromMs, toMs]);
  const payrollArgs = useMemo(
    () => (userId ? { userId, fromMs, toMs } : "skip"),
    [userId, fromMs, toMs],
  );
  const orgPayrollArgs = useMemo(
    () => (isModerator && orgId && !userId ? { orgId, fromMs, toMs } : "skip"),
    [isModerator, orgId, userId, fromMs, toMs],
  );
  const {
    data: resultData,
    error: resultError,
    isLoading: resultLoading,
    retry: retryResult,
  } = useQueryResult<PayrollResult>(
    api.payroll.calcForEmployee,
    payrollArgs as never,
  );
  const {
    data: orgRowsData,
    error: orgRowsError,
    isLoading: orgRowsLoading,
    retry: retryOrgRows,
  } = useQueryResult<OrgPayrollRow[]>(
    api.payroll.calcForOrg,
    orgPayrollArgs as never,
  );
  const orgRows = orgRowsData === null ? undefined : (orgRowsData as OrgPayrollRow[] | undefined);
  const {
    data: supportedData,
    error: supportedError,
    retry: retrySupported,
  } = useQueryResult<SupportedStrategy[]>(
    api.payroll.listSupportedStrategies,
  );
  const supported = supportedData === null ? undefined : (supportedData as SupportedStrategy[] | undefined);
  const result = resultData === null ? undefined : (resultData as PayrollResult | undefined);
  const [payStrategyBusy, setPayStrategyBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  // Revoke-timer for the CSV object URL — cleared on unmount (audit 2026-11-11, P3-D20).
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revokeTimerRef.current !== null) clearTimeout(revokeTimerRef.current);
    },
    []
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const setPayStrategy = useMutation(api.payroll.setPayStrategy);
  const exportLogsCsv = useAction(api.payroll.exportLogsCsv);
  const locale = browserLocale();
  const dayPages = usePagination(result?.days ?? [], 6);

  function download(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // Defer revocation — revoking synchronously can cancel the download before it starts.
    if (revokeTimerRef.current !== null) clearTimeout(revokeTimerRef.current);
    revokeTimerRef.current = setTimeout(() => {
      URL.revokeObjectURL(url);
      revokeTimerRef.current = null;
    }, 10_000);
  }

  return (
    <ConsoleWindow title="Payroll" className={`h-full ${className ?? ""}`} bodyClassName="flex min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-none flex-wrap items-center gap-2 text-sm">
        {isModerator && orgId && userId && (
          <button
            type="button"
            onClick={() => setUserId("")}
            className="btn-surgical px-3 py-1.5 text-xs font-semibold text-[var(--fog)] hover:text-[var(--paper)]"
          >
            ← All employees
          </button>
        )}
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value as Id<"users">)}
          className="input-surgical px-3 py-2"
        >
          <option value="">{isModerator && orgId ? "All employees…" : "Employee…"}</option>
          {active.map((e) => (
            <option key={e._id} value={e._id}>
              {e.name ?? e.email}
            </option>
          ))}
        </select>
        {([1, 2, 4] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWeeks(w)}
            className={`btn-surgical pill-surgical px-3.5 py-1.5 text-xs font-semibold ${
              weeks === w
                ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--mint)]"
                : "text-[var(--fog)]"
            }`}
            aria-pressed={weeks === w}
          >
            {w === 1 ? "This week" : `${w} weeks`}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o - weeks)}
            className="btn-surgical px-2.5 py-1.5 text-xs font-semibold text-[var(--fog)]"
            aria-label="Previous period"
          >
            ‹ Prev
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
            className="btn-surgical px-2.5 py-1.5 text-xs font-semibold text-[var(--fog)] disabled:opacity-40"
          >
            Current
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => Math.min(0, o + weeks))}
            disabled={weekOffset >= 0}
            className="btn-surgical px-2.5 py-1.5 text-xs font-semibold text-[var(--fog)] disabled:opacity-40"
            aria-label="Next period"
          >
            Next ›
          </button>
          <span className="tnum ml-1 text-xs text-[var(--fog)]">{periodLabel}</span>
        </div>
        {isModerator && userId && (
          <select
            value={result?.strategy ?? ""}
            onChange={async (e) => {
              const strategy = e.target.value;
              if (!strategy || payStrategyBusy) return;
              setPayStrategyBusy(true);
              setSaveError(null);
              try {
                await setPayStrategy({ userId: userId as Id<"users">, strategy: strategy as "flat" | "bcea" | "dailyOvertime" | "flsa" | "wtr_uk" });
              } catch (err) {
                setSaveError(errMsg(err));
              } finally {
                setPayStrategyBusy(false);
              }
            }}
            disabled={payStrategyBusy}
            className="input-surgical px-3 py-2 disabled:opacity-50"
            aria-label="Pay strategy"
          >
            <option value="" disabled>
              Strategy…
            </option>
            <option value="flat">Standard Flat Rate</option>
            <option value="dailyOvertime">Daily Overtime (&gt;8h @ 1.5×)</option>
            {(supported ?? []).map((s) => (
              <option key={s.code} value={s.strategy}>
                {s.displayName} ({s.currencySymbol} {s.currency})
              </option>
            ))}
          </select>
        )}
        {userId && (
          <button
            onClick={async () => {
              if (!userId || exportBusy) return;
              setExportBusy(true);
              setSaveError(null);
              try {
                const out = await exportLogsCsv({
                  userId: userId as Id<"users">,
                  fromMs,
                  toMs,
                });
                download(out.filename, out.csv);
              } catch (err) {
                setSaveError(errMsg(err));
              } finally {
                setExportBusy(false);
              }
            }}
            disabled={exportBusy}
            className="btn-surgical ml-auto min-h-[44px] px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Export logs CSV
          </button>
        )}
      </div>
      {saveError && <p role="alert" className="flex-none text-xs font-semibold text-[var(--hivis)]">{saveError}</p>}
      {supportedError && (
        <QueryError error={supportedError} onRetry={retrySupported} label="Supported strategies" />
      )}
      {resultError && (
        <QueryError error={resultError} onRetry={retryResult} label="Payroll estimate" />
      )}
      {resultLoading && !result && !resultError && userId && (
        <p className="flex-none text-xs text-[var(--fog)]">Loading payroll…</p>
      )}
      {isModerator && orgId && !userId && orgRowsError && (
        <QueryError error={orgRowsError} onRetry={retryOrgRows} label="Org payroll summary" />
      )}
      {isModerator && orgId && !userId && orgRowsLoading && !orgRows && !orgRowsError && (
        <p className="flex-none text-xs text-[var(--fog)]">Loading org payroll…</p>
      )}
      {isModerator && orgId && !userId && orgRows && (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--panel)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Employee</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Shifts</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Payable</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Strategy</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Flagged</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Est. Pay</th>
              </tr>
            </thead>
            <tbody>
              {orgRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-[var(--fog)]">
                    No employees in this organization.
                  </td>
                </tr>
              ) : (
                orgRows.map((row) => {
                  const mins = row.payableMinutes ?? 0;
                  const hrs = (mins / 60).toFixed(1);
                  return (
                    <tr
                      key={row.userId}
                      onClick={() => setUserId(row.userId)}
                      className="cursor-pointer border-t border-[var(--line)]/50 transition hover:bg-[var(--panel-elevated)]/40"
                    >
                      <td className="px-3 py-1.5 font-medium text-[var(--paper)]">
                        {row.name ?? row.email ?? row.userId}
                      </td>
                      <td className="tnum px-3 py-1.5 text-right text-[var(--text-secondary)]">
                        {row.shiftCount ?? 0}
                      </td>
                      <td className="tnum px-3 py-1.5 text-right text-[var(--text-secondary)]">
                        {mins}m ({hrs}h)
                      </td>
                      <td className="px-3 py-1.5 text-[var(--fog)]">
                        {row.strategy ?? "—"}
                      </td>
                      <td className={`tnum px-3 py-1.5 text-right ${row.flaggedCount ? "font-semibold text-[var(--hivis)]" : "text-[var(--text-secondary)]"}`}>
                        {row.flaggedCount ?? 0}
                      </td>
                      <td className="tnum px-3 py-1.5 text-right font-medium">
                        {row.status === "no_rate" ? (
                          <span className="text-[var(--fog)]">no rate set</span>
                        ) : row.status === "error" ? (
                          <span className="text-[var(--hivis)]" title={row.error}>error</span>
                        ) : (
                          <span className="text-[var(--mint)]">
                            {formatCurrency(row.pay ?? 0, row.currency ?? "ZAR", row.locale ?? locale)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="tnum mb-1.5 flex-none text-xs text-[var(--fog)]">
            Rate <span className="font-semibold text-[var(--paper)]">{formatCurrency(result.rate, result.currency, result.locale ?? locale)}</span>/h · {result.strategy} · tz {result.timezone} ·{" "}
            <span className={result.totals.flaggedCount ? "font-semibold text-[var(--hivis)]" : ""}>
              {result.totals.flaggedCount} flagged excluded
            </span>
          </p>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--panel)] text-[var(--fog)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Day</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Minutes</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Pay ({result.currency})</th>
                </tr>
              </thead>
              <tbody>
                {dayPages.pageItems.map((d) => (
                  <tr key={d.day} className="border-t border-[var(--line)]/50 transition hover:bg-[var(--panel-elevated)]/40">
                    <td className="px-3 py-1.5 text-[var(--paper)]">{d.day}</td>
                    <td className="tnum px-3 py-1.5 text-right text-[var(--text-secondary)]">{d.minutes}</td>
                    <td className="tnum px-3 py-1.5 text-right font-medium text-[var(--paper)]">{formatCurrency(d.pay, result.currency, result.locale ?? locale)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--line)] bg-[var(--panel)] font-semibold">
                  <td className="px-3 py-1.5 text-[var(--paper)]">Total ({result.totals.shiftCount} shifts)</td>
                  <td className="tnum px-3 py-1.5 text-right text-[var(--paper)]">{result.totals.payableMinutes}</td>
                  <td className="tnum px-3 py-1.5 text-right font-bold text-[var(--mint)]">{formatCurrency(result.totals.pay, result.currency, result.locale ?? locale)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Pager page={dayPages.page} pageCount={dayPages.pageCount} total={dayPages.total} onPage={dayPages.setPage} label="Days" />
          {result.flagged.length > 0 && (
            <ul className="mt-1.5 flex flex-none flex-col gap-0.5 text-xs text-[var(--hivis)]">
              {result.flagged.slice(0, 2).map((f) => (
                <li key={f.startedAt} className="tnum flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--hivis)]" />
                  {formatDateTime(f.startedAt, result.locale ?? locale)} — {f.reason ?? "flagged"} ({f.minutes ?? "?"} min held)
                </li>
              ))}
              {result.flagged.length > 2 && (
                <li className="pl-3 text-[var(--fog)]">+{result.flagged.length - 2} more flagged shift(s) in export</li>
              )}
            </ul>
          )}
        </div>
      )}
    </ConsoleWindow>
  );
}

export function ReviewPanel({ className }: { className?: string }) {
  const { orgId, userFilter } = useOrg();
  const { data: reviewData, error: reviewError, retry: retryReview } =
    useQueryResult<any[]>(api.moderator.auditNeedsReview, (orgId ? { orgId } : "skip") as never);
  const allReview = reviewData === null ? undefined : (reviewData as any[] | undefined);
  const review = allReview && userFilter ? allReview.filter((s) => s.userId === userFilter) : allReview;
  const resolveShift = useMutation(api.moderator.resolveShift);
  const recompute = useMutation(api.moderator.recomputeEmployeeShifts);
  const locale = useUserLocale();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const list = usePagination<any>(review ?? [], 3);
  return (
    <ConsoleWindow title={`Shifts needing review${review ? ` · ${review.length}` : ""}`} className={`h-full ${className ?? ""}`} bodyClassName="flex min-h-0 flex-col gap-1 p-3">
      {review === undefined && <p className="text-xs text-[var(--fog)]">Loading…</p>}
      {review !== undefined && (review ?? []).length === 0 && <p className="text-xs text-[var(--fog)]">Nothing flagged.</p>}
      {list.pageItems.map((s: { _id: Id<"shifts">; startedAt: number; userId: Id<"users">; reviewReason?: string | null; employeeName?: string }) => (
        <div key={s._id} className="flex flex-none flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] p-2 text-xs">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--paper)]">{s.employeeName ?? "unknown"}</span>
            <span className="tnum font-medium text-[var(--text-secondary)]">{formatDateTime(s.startedAt, locale)}</span>
            <span className="rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">{s.reviewReason}</span>
          </span>
          <span className="inline-flex flex-none gap-1.5">
            <button
              data-testid="review-recompute"
              onClick={async () => {
                if (busy[s._id]) return;
                setBusy({ ...busy, [s._id]: true });
                setActionError(null);
                try {
                  await recompute({ userId: s.userId });
                } catch (e) {
                  setActionError(errMsg(e));
                } finally {
                  setBusy({ ...busy, [s._id]: false });
                }
              }}
              disabled={busy[s._id]}
              className="btn-surgical min-h-[44px] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {busy[s._id] ? "Working…" : "Recompute"}
            </button>
            <button
              data-testid="review-resolve"
              onClick={async () => {
                if (busy[s._id]) return;
                setBusy({ ...busy, [s._id]: true });
                setActionError(null);
                try {
                  await resolveShift({ shiftId: s._id });
                } catch (e) {
                  setActionError(errMsg(e));
                } finally {
                  setBusy({ ...busy, [s._id]: false });
                }
              }}
              disabled={busy[s._id]}
              className="btn-surgical btn-surgical-mint min-h-[44px] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {busy[s._id] ? "Working…" : "Resolve"}
            </button>
          </span>
        </div>
      ))}
      {reviewError && <QueryError error={reviewError} onRetry={retryReview} label="Needs-review list" />}
      <Pager page={list.page} pageCount={list.pageCount} total={list.total} onPage={list.setPage} label="Flagged shifts" />
      {actionError && <p role="alert" className="mt-1.5 flex-none text-xs font-semibold text-[var(--hivis)]">{actionError}</p>}
    </ConsoleWindow>
  );
}
