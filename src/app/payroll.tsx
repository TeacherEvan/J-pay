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

export function PayrollPanel({ employees, role, className }: { employees: { _id: Id<"users">; name?: string | null; email?: string | null; archivedAt?: number; locale?: string }[]; role?: "moderator" | "employee"; className?: string }) {
  const [userId, setUserId] = useState("");
  // ISO-week-aligned periods (1/2/4 weeks, Mon–Sun). A rolling N-day window straddles
  // two ISO weeks, resetting the BCEA weekly overtime cap for each half and erasing
  // statutory OT the worker already earned (audit 2026-11-11, P1-B1). No free-form
  // window is offered anymore: every selectable period is complete ISO weeks, so the
  // 45h/week cap is always consumed correctly.
  const [weeks, setWeeks] = useState<1 | 2 | 4>(1);
  const active = employees.filter((e) => !e.archivedAt);
  // Re-anchor at local midnight so an open panel never drifts stale across days.
  const dayKey = new Date().toDateString();
  const monday = useMemo(
    () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      // Monday=0..Sunday=6 (getDay: Sunday=0)
      return (d.getDay() + 6) % 7 === 0 ? d.getTime() : d.getTime() - ((d.getDay() + 6) % 7) * 24 * 3600 * 1000;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayKey],
  );
  const fromMs = monday;
  const toMs = useMemo(
    () => {
      const d = new Date(monday);
      d.setHours(0, 0, 0, 0);
      d.setTime(d.getTime() + weeks * 7 * 24 * 3600 * 1000);
      // End-exclusive is not supported by the API; use the last ms of the last day.
      return d.getTime() - 1;
    },
    [monday, weeks],
  );
  const payrollArgs = useMemo(
    () => (userId ? { userId, fromMs, toMs } : "skip"),
    [userId, fromMs, toMs],
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
  const isModerator = role === "moderator";
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
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value as Id<"users">)}
          className="input-surgical px-3 py-2"
        >
          <option value="">Employee…</option>
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
  const { data: reviewData, error: reviewError, retry: retryReview } =
    useQueryResult<any[]>(api.moderator.auditNeedsReview);
  const review = reviewData === null ? undefined : (reviewData as any[] | undefined);
  const resolveShift = useMutation(api.moderator.resolveShift);
  const recompute = useMutation(api.moderator.recomputeEmployeeShifts);
  const locale = useUserLocale();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const list = usePagination<any>(review ?? [], 3);
  return (
    <ConsoleWindow title="Shifts needing review" className={`h-full ${className ?? ""}`} bodyClassName="flex min-h-0 flex-col gap-1 p-3">
      {review === undefined && <p className="text-xs text-[var(--fog)]">Loading…</p>}
      {review !== undefined && (review ?? []).length === 0 && <p className="text-xs text-[var(--fog)]">Nothing flagged.</p>}
      {list.pageItems.map((s: { _id: Id<"shifts">; startedAt: number; userId: Id<"users">; reviewReason?: string | null }) => (
        <div key={s._id} className="flex flex-none flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] p-2 text-xs">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="tnum font-medium text-[var(--paper)]">{formatDateTime(s.startedAt, locale)}</span>
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
