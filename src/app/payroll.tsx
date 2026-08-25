"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCurrency, formatDateTime, browserLocale } from "../lib/format";

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

export function PayrollPanel({ employees, role }: { employees: { _id: Id<"users">; name?: string | null; email?: string | null; archivedAt?: number }[]; role?: "moderator" | "employee" }) {
  const [userId, setUserId] = useState("");
  const [range, setRange] = useState<7 | 14 | 28>(7);
  const active = employees.filter((e) => !e.archivedAt);
  const fromMs = Date.now() - range * 24 * 3600 * 1000;
  const result = useQuery(
    api.payroll.calcForEmployee,
    userId ? ({ userId, fromMs, toMs: Date.now() + 3600_000 } as never) : "skip"
  ) as PayrollResult | undefined;
  const supported = useQuery(api.payroll.listSupportedStrategies, {} as never) as
    | SupportedStrategy[]
    | undefined;
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
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Payroll
      </h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value as Id<"users">)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
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
            className={`rounded-full border px-3 py-1.5 text-xs ${
              range === d
                ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                : "border-neutral-800 bg-neutral-900 text-neutral-400"
            }`}
          >
            {d}d
          </button>
        ))}
        {isModerator && userId && (
          <select
            value={result?.strategy ?? ""}
            onChange={(e) => void setPayStrategy({ userId: userId as Id<"users">, strategy: e.target.value as "flat" | "bcea" | "dailyOvertime" | "flsa" | "wtr_uk" })}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
            aria-label="Pay strategy"
          >
            <option value="" disabled>
              Strategy…
            </option>
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
                toMs: Date.now() + 3600_000,
              });
              download(out.filename, out.csv);
            }}
            className="ml-auto rounded-md border border-neutral-700 px-3 py-1.5 text-xs"
          >
            Export logs CSV
          </button>
        )}
      </div>
      {result && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-neutral-500">
            Rate {formatCurrency(result.rate, result.currency, result.locale ?? locale)}/h · strategy {result.strategy} · tz {result.timezone} ·{" "}
            <span className={result.totals.flaggedCount ? "text-amber-400" : ""}>
              {result.totals.flaggedCount} flagged shift(s) excluded
            </span>
          </p>
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="p-2">Day</th>
                <th className="p-2">Minutes</th>
                <th className="p-2">Pay ({result.currency})</th>
              </tr>
            </thead>
            <tbody>
              {result.days.map((d) => (
                <tr key={d.day} className="border-t border-neutral-900">
                  <td className="p-2">{d.day}</td>
                  <td className="p-2">{d.minutes}</td>
                  <td className="p-2">{formatCurrency(d.pay, result.currency, result.locale ?? locale)}</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-700 font-semibold">
                <td className="p-2">Total ({result.totals.shiftCount} shifts)</td>
                <td className="p-2">{result.totals.payableMinutes}</td>
                <td className="p-2">{formatCurrency(result.totals.pay, result.currency, result.locale ?? locale)}</td>
              </tr>
            </tbody>
          </table>
          {result.flagged.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-[11px] text-amber-300/80">
              {result.flagged.map((f) => (
                <li key={f.startedAt}>
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
  const locale = browserLocale();
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Shifts needing review
      </h2>
      {(review ?? []).length === 0 && <p className="text-xs text-neutral-600">Nothing flagged.</p>}
      {(review ?? []).map((s: { _id: Id<"shifts">; startedAt: number; userId: Id<"users">; reviewReason?: string | null }) => (
        <div key={s._id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-900 py-2 text-xs first:border-0">
          <span>
            {formatDateTime(s.startedAt, locale)}
            <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-red-300">{s.reviewReason}</span>
          </span>
          <span className="flex gap-2">
            <button
              onClick={() => void recompute({ userId: s.userId })}
              className="rounded border border-neutral-700 px-2 py-1"
            >
              Recompute
            </button>
            <button
              onClick={() => void resolveShift({ shiftId: s._id })}
              className="rounded bg-emerald-500 px-2 py-1 font-semibold text-emerald-950"
            >
              Resolve
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
