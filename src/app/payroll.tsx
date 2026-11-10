"use client";

import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { useMemo, useState } from "react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCurrency, formatDateTime, browserLocale } from "../lib/format";
import { useUserLocale } from "../lib/use-user-locale";
import { ConsoleWindow } from "@/components/console/window";
import { Pager } from "@/components/console/pager";
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
  const [range, setRange] = useState<7 | 14 | 28>(7);
  const active = employees.filter((e) => !e.archivedAt);
  // Re-anchor at local midnight so an open panel never drifts stale across days.
  const dayKey = new Date().toDateString();
  const fromMs = useMemo(
    () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime() - (range - 1) * 24 * 3600 * 1000;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, dayKey],
  );
  const toMs = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);
  const payrollArgs = useMemo(
    () => (userId ? { userId, fromMs, toMs } : "skip"),
    [userId, fromMs, toMs],
  );
  const result = useQuery(
    api.payroll.calcForEmployee,
    payrollArgs as never,
  ) as PayrollResult | undefined;
  const supported = useQuery(
    api.payroll.listSupportedStrategies,
  ) as SupportedStrategy[] | undefined;
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
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
        {([7, 14, 28] as const).map((d) => (
          <button
            key={d}
            onClick={() => setRange(d)}
            className={`btn-surgical pill-surgical px-3.5 py-1.5 text-xs font-semibold ${
              range === d
                ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--mint)]"
                : "text-[var(--fog)]"
            }`}
          >
            {d}d
          </button>
        ))}
        {isModerator && userId && (
          <select
            value={result?.strategy ?? ""}
            onChange={(e) => void setPayStrategy({ userId: userId as Id<"users">, strategy: e.target.value as "flat" | "bcea" | "dailyOvertime" | "flsa" | "wtr_uk" })}
            className="input-surgical px-3 py-2"
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
              const out = await exportLogsCsv({
                userId: userId as Id<"users">,
                fromMs,
                toMs,
              });
              download(out.filename, out.csv);
            }}
            className="btn-surgical ml-auto min-h-[44px] px-4 py-2 text-xs font-semibold"
          >
            Export logs CSV
          </button>
        )}
      </div>
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
  const review = useQuery(api.moderator.auditNeedsReview);
  const resolveShift = useMutation(api.moderator.resolveShift);
  const recompute = useMutation(api.moderator.recomputeEmployeeShifts);
  const locale = useUserLocale();
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
              onClick={() => void recompute({ userId: s.userId })}
              className="btn-surgical min-h-[44px] px-3 py-1.5 text-xs font-medium"
            >
              Recompute
            </button>
            <button
              data-testid="review-resolve"
              onClick={() => void resolveShift({ shiftId: s._id })}
              className="btn-surgical btn-surgical-mint min-h-[44px] px-3 py-1.5 text-xs font-semibold"
            >
              Resolve
            </button>
          </span>
        </div>
      ))}
      <Pager page={list.page} pageCount={list.pageCount} total={list.total} onPage={list.setPage} label="Flagged shifts" />
    </ConsoleWindow>
  );
}
