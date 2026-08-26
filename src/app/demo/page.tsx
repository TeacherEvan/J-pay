"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { errMsg } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";
import { CheckInCard } from "../check-in-card";

function formatMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min.toString().padStart(2, "0")}m` : `${min}m`;
}

function formatMsDateTime(ms: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatMsTime(ms: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ms));
}

export default function DemoPage() {
  const binding = useQuery(api.demo.getBinding);
  const kpi = useQuery(api.demo.demoKpis);
  const payroll = useQuery(api.demo.boundPersonaPayroll);
  const needsReview = useQuery(api.demo.demoNeedsReview);
  const audit = useQuery(api.demo.demoAudit, { limit: 50 });
  const roster = useQuery(api.demo.demoEmployeeRoster);
  const sites = useQuery(api.demo.boundPersonaSites);
  const inbox = useQuery(api.demo.demoModeratorInbox);
  const userLocale = useUserLocale();
  const personaLocale = payroll?.locale ?? userLocale;

  return (
    <div className="flex flex-col gap-8" data-testid="demo-page">
      <PersonaHeader binding={binding} />

      <CheckInCard variant="persona" />

      <section data-testid="demo-kpi-banner">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">KPIs (persona-scoped)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Active on site" value={kpi?.activeOnSite ?? "—"} />
          <KpiCard label="Billable this week" value={kpi ? formatMinutes(kpi.weeklyBillableMinutes) : "—"} />
          <KpiCard label="Pending reviews" value={kpi?.pendingReviews ?? "—"} />
          <KpiCard label="Anomalies (24h)" value={kpi?.anomalies24h ?? "—"} />
        </div>
      </section>

      <PayrollTable payroll={payroll ?? null} />
      <ReviewList shifts={needsReview ?? undefined} personaLocale={personaLocale} />
      <AuditTable logs={audit ?? undefined} personaLocale={personaLocale} />
      <MessagesSection inbox={inbox ?? undefined} personaLocale={personaLocale} />
      <RosterList users={roster ?? undefined} />
      <ExportPanel />
    </div>
  );
}

function PersonaHeader({ binding }: { binding: { personaName: string; personaEmail: string } | null | undefined }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4" data-testid="demo-persona-header">
      <h2 className="text-lg font-semibold text-neutral-100">{binding?.personaName ?? "—"}</h2>
      <p className="text-sm text-neutral-400">{binding?.personaEmail}</p>
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3" data-testid="kpi-card">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-100">{value}</p>
    </div>
  );
}

function PayrollTable({ payroll }: { payroll: { rate: number; currency: string; locale: string; days: { day: string; minutes: number; pay: number }[]; totals: { minutes: number; pay: number } } | null }) {
  if (!payroll) return <section><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">My week (payroll)</h2><p className="text-sm text-neutral-500">Loading…</p></section>;
  return (
    <section data-testid="demo-payroll">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">My week (payroll)</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2 text-right">Minutes</th>
              <th className="px-3 py-2 text-right">Pay</th>
            </tr>
          </thead>
          <tbody>
            {payroll.days.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-3 text-center text-sm text-neutral-500">No shifts yet</td></tr>
            )}
            {payroll.days.map((d) => (
              <tr key={d.day} className="border-t border-neutral-800" data-testid="payroll-day-row">
                <td className="px-3 py-2">{d.day}</td>
                <td className="px-3 py-2 text-right">{d.minutes}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(d.pay, payroll.currency, payroll.locale)}</td>
              </tr>
            ))}
            <tr className="border-t border-neutral-700 bg-neutral-900 font-semibold" data-testid="payroll-total-row">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{payroll.totals.minutes}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(payroll.totals.pay, payroll.currency, payroll.locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-neutral-500">Rate {formatCurrency(payroll.rate, payroll.currency, payroll.locale)}/h · currency {payroll.currency}</p>
    </section>
  );
}

function ReviewList({ shifts, personaLocale }: { shifts: { _id: string; startedAt: number; reviewReason?: string; totalMinutes?: number }[] | undefined; personaLocale: string }) {
  const resolve = useMutation(api.demo.demoResolveShift);
  const recompute = useMutation(api.demo.demoRecomputeEmployeeShifts);
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <section data-testid="demo-needs-review">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Shifts needing review</h2>
      {(shifts ?? []).length === 0 ? (
        <p className="text-sm text-neutral-500">No shifts flagged.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts!.map((s) => (
            <li
              key={s._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-700/30 bg-amber-900/20 px-3 py-2 text-sm"
              data-testid="needs-review-row"
            >
              <div>
                <p className="text-neutral-200">{formatMsDateTime(s.startedAt, personaLocale)}</p>
                <p className="text-neutral-500">{s.reviewReason ?? "flagged"} · {s.totalMinutes ?? 0} min</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBusyId(s._id);
                    recompute({ userId: s._id as unknown as Id<"users"> }).catch(() => {}).finally(() => setBusyId(null));
                  }}
                  disabled={busyId === s._id}
                  className="rounded-md border border-neutral-700 px-3 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                  Recompute
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBusyId(s._id);
                    resolve({ shiftId: s._id as Id<"shifts"> }).catch(() => {}).finally(() => setBusyId(null));
                  }}
                  disabled={busyId === s._id}
                  className="rounded-md bg-emerald-500 px-3 py-2.5 text-sm text-emerald-950 hover:bg-emerald-400"
                >
                  Resolve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditTable({ logs, personaLocale }: { logs: { _id: string; status: string; at: number; accuracyMeters: number; clockSkewMs: number; isWithinGeofence: boolean; impossibleTravelFlag: boolean; siteName: string }[] | undefined; personaLocale: string }) {
  return (
    <section data-testid="demo-audit-log">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Audit log</h2>
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">±m</th>
              <th className="px-3 py-2 text-right">Skew s</th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-center text-neutral-500">No audit entries in the last 7 days</td></tr>
            )}
            {(logs ?? []).map((l) => (
              <tr key={l._id} className="border-t border-neutral-800" data-testid="audit-log-row">
                <td className="px-3 py-2 text-neutral-300">{formatMsTime(l.at, personaLocale)}</td>
                <td className="px-3 py-2">{l.status}</td>
                <td className="px-3 py-2 text-right">{l.accuracyMeters}</td>
                <td className="px-3 py-2 text-right">{Math.round(l.clockSkewMs / 1000)}</td>
                <td className="px-3 py-2 text-amber-400">
                  {!l.isWithinGeofence && <span>outside</span>}
                  {l.impossibleTravelFlag && <span> · travel</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RosterList({ users }: { users: { _id: string; name?: string; email?: string; role: string }[] | undefined }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Demo personas</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {(users ?? []).map((u) => (
            <li key={u._id} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm">
            <p className="text-neutral-200">{u.name ?? u.email ?? "—"}</p>
            <p className="text-neutral-500">{u.email}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MessagesSection({ inbox, personaLocale }: { inbox: { _id: string; content: string; isRead: boolean; at: number }[] | undefined; personaLocale: string }) {
  const markRead = useMutation(api.demo.demoMarkQueueItemRead);
  return (
    <section data-testid="demo-messages">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">My moderator messages</h2>
      {(inbox ?? []).length === 0 ? (
        <p className="text-sm text-neutral-500">No messages from this persona to the moderator queue.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inbox!.map((m) => (
            <li
              key={m._id}
              className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-sm"
              data-testid="message-row"
            >
              <p className="text-neutral-100">{m.content}</p>
              <div className="mt-1 flex items-center justify-between text-neutral-500">
                <span>{formatMsDateTime(m.at, personaLocale)}</span>
                {m.isRead ? (
                  <span className="text-neutral-400">read</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead({ messageId: m._id as Id<"messages"> }).catch(() => {})}
                    className="rounded-md border border-neutral-700 px-3 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExportPanel() {
  const exportCsv = useAction(api.demo.demoExportLogsCsv);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function doExport() {
    setBusy(true);
    setMessage(null);
    try {
      const toMs = Date.now();
      const fromMs = toMs - 14 * 24 * 3600 * 1000;
      const out = await exportCsv({ fromMs, toMs });
      const blob = new Blob([out.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage(`Exported ${out.filename}.`);
    } catch (e) {
      setMessage(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-testid="demo-export" className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Export my logs</h2>
      <button
        type="button"
        onClick={() => void doExport()}
        disabled={busy}
        className="rounded-md border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Building CSV…" : "Download CSV (last 14 days)"}
      </button>
      {message && <p className="mt-2 text-sm text-neutral-400">{message}</p>}
    </section>
  );
}
