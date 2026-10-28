"use client";

import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { useMemo, useState } from "react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCurrency, formatDateTime, browserLocale } from "../lib/format";
import { useUserLocale } from "../lib/use-user-locale";

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

export function PayrollPanel({ employees, role }: { employees: { _id: Id<"users">; name?: string | null; email?: string | null; archivedAt?: number; locale?: string }[]; role?: "moderator" | "employee" }) {
  const [userId, setUserId] = useState("");
  const [range, setRange] = useState<7 | 14 | 28>(7);
  const active = employees.filter((e) => !e.archivedAt);
  const fromMs = useMemo(
    () => Date.now() - range * 24 * 3600 * 1000,
    [range],
  );
  const toMs = useMemo(() => Date.now() + 3600_000, [range]);
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

  function download(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card-surgical p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Payroll
      </h2>
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
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
        <div className="mt-4">
          <p className="tnum mb-2.5 text-xs text-[var(--fog)]">
            Rate <span className="font-semibold text-[var(--paper)]">{formatCurrency(result.rate, result.currency, result.locale ?? locale)}</span>/h · strategy {result.strategy} · tz {result.timezone} ·{" "}
            <span className={result.totals.flaggedCount ? "font-semibold text-[var(--hivis)]" : ""}>
              {result.totals.flaggedCount} flagged shift(s) excluded
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel-2)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--panel)] text-[var(--fog)]">
                <tr>
                  <th scope="col" className="p-3 text-xs uppercase tracking-wider">Day</th>
                  <th scope="col" className="p-3 text-right text-xs uppercase tracking-wider">Minutes</th>
                  <th scope="col" className="p-3 text-right text-xs uppercase tracking-wider">Pay ({result.currency})</th>
                </tr>
              </thead>
              <tbody>
                {result.days.map((d) => (
                  <tr key={d.day} className="border-t border-[var(--line)]/50 hover:bg-[var(--panel-elevated)]/40 transition">
                    <td className="p-3 text-[var(--paper)]">{d.day}</td>
                    <td className="tnum p-3 text-right text-[var(--text-secondary)]">{d.minutes}</td>
                    <td className="tnum p-3 text-right font-medium text-[var(--paper)]">{formatCurrency(d.pay, result.currency, result.locale ?? locale)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--line)] bg-[var(--panel)] font-semibold">
                  <td className="p-3 text-[var(--paper)]">Total ({result.totals.shiftCount} shifts)</td>
                  <td className="tnum p-3 text-right text-[var(--paper)]">{result.totals.payableMinutes}</td>
                  <td className="tnum p-3 text-right text-[var(--mint)] font-bold">{formatCurrency(result.totals.pay, result.currency, result.locale ?? locale)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {result.flagged.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--hivis)]">
              {result.flagged.map((f) => (
                <li key={f.startedAt} className="tnum flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--hivis)]" />
                  {formatDateTime(f.startedAt, result.locale ?? locale)} — {f.reason ?? "flagged"} ({f.minutes ?? "?"} min held)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function ReviewPanel() {
  const review = useQuery(api.moderator.auditNeedsReview);
  const resolveShift = useMutation(api.moderator.resolveShift);
  const recompute = useMutation(api.moderator.recomputeEmployeeShifts);
  const locale = useUserLocale();
  return (
    <section className="card-surgical p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Shifts needing review
      </h2>
      {(review ?? []).length === 0 && <p className="text-sm text-[var(--fog)]">Nothing flagged.</p>}
      {(review ?? []).map((s: { _id: Id<"shifts">; startedAt: number; userId: Id<"users">; reviewReason?: string | null }) => (
        <div key={s._id} className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[var(--line)]/50 py-3 text-sm first:border-0">
          <span className="flex items-center gap-2">
            <span className="tnum font-medium text-[var(--paper)]">{formatDateTime(s.startedAt, locale)}</span>
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">{s.reviewReason}</span>
          </span>
          <span className="flex gap-2">
            <button
              data-testid="review-recompute"
              onClick={() => void recompute({ userId: s.userId })}
              className="btn-surgical min-h-[44px] px-3.5 py-1.5 text-xs font-medium"
            >
              Recompute
            </button>
            <button
              data-testid="review-resolve"
              onClick={() => void resolveShift({ shiftId: s._id })}
              className="btn-surgical btn-surgical-mint min-h-[44px] px-3.5 py-1.5 text-xs font-semibold"
            >
              Resolve
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
