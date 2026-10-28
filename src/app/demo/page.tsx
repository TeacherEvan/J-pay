"use client";

import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { useState } from "react";
import { api } from "@/lib/backend/api";
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
        {/* KPIs: tabular-nums (tnum) telemetry readouts */}
        <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">KPIs (persona-scoped)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 tnum">
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
    <section className="card-surgical p-4" data-testid="demo-persona-header">
      <h2 className="text-lg font-bold tracking-tight text-[var(--paper)]">{binding?.personaName ?? "—"}</h2>
      <p className="text-xs font-mono text-[var(--paper-dim)]">{binding?.personaEmail}</p>
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-surgical p-3" data-testid="kpi-card">
      <p className="text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--paper)] tnum font-mono">{value}</p>
    </div>
  );
}

function PayrollTable({ payroll }: { payroll: { rate: number; currency: string; locale: string; days: { day: string; minutes: number; pay: number }[]; totals: { minutes: number; pay: number } } | null }) {
  if (!payroll) return <section><h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">My week (payroll)</h2><p className="text-sm text-[var(--paper-dimmer)]">Loading…</p></section>;
  return (
    <section data-testid="demo-payroll">
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">My week (payroll)</h2>
      <div className="card-surgical overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-left text-xs uppercase tracking-wider text-[var(--paper-dimmer)] font-mono">
            <tr>
              <th scope="col" className="px-3 py-2">Day</th>
              <th scope="col" className="px-3 py-2 text-right">Minutes</th>
              <th scope="col" className="px-3 py-2 text-right">Pay</th>
            </tr>
          </thead>
          <tbody>
            {payroll.days.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-3 text-center text-sm text-[var(--paper-dimmer)]">No shifts yet</td></tr>
            )}
            {payroll.days.map((d) => (
              <tr key={d.day} className="border-t border-[var(--line-subtle)] hover:bg-[var(--surface-raised)]/30 transition-colors" data-testid="payroll-day-row">
                <td className="px-3 py-2 text-[var(--paper)] font-medium">{d.day}</td>
                <td className="px-3 py-2 text-right text-[var(--paper-dim)] tnum font-mono">{d.minutes}</td>
                <td className="px-3 py-2 text-right text-[var(--paper)] tnum font-mono font-medium">{formatCurrency(d.pay, payroll.currency, payroll.locale)}</td>
              </tr>
            ))}
            <tr className="border-t border-[var(--line)] bg-[var(--surface-raised)] font-semibold" data-testid="payroll-total-row">
              <td className="px-3 py-2 text-[var(--paper)]">Total</td>
              <td className="px-3 py-2 text-right text-[var(--paper)] tnum font-mono">{payroll.totals.minutes}</td>
              <td className="px-3 py-2 text-right text-emerald-400 tnum font-mono">{formatCurrency(payroll.totals.pay, payroll.currency, payroll.locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs font-mono text-[var(--paper-dimmer)]">Rate {formatCurrency(payroll.rate, payroll.currency, payroll.locale)}/h · currency {payroll.currency}</p>
    </section>
  );
}

function ReviewList({ shifts, personaLocale }: { shifts: { _id: string; userId: Id<"users">; startedAt: number; reviewReason?: string; totalMinutes?: number }[] | undefined; personaLocale: string }) {
  const resolve = useMutation(api.demo.demoResolveShift);
  const recompute = useMutation(api.demo.demoRecomputeEmployeeShifts);
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <section data-testid="demo-needs-review">
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Shifts needing review</h2>
      {(shifts ?? []).length === 0 ? (
        <p className="text-sm text-[var(--paper-dimmer)]">No shifts flagged.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts!.map((s) => (
            <li
              key={s._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm"
              data-testid="needs-review-row"
            >
              <div>
                <p className="text-[var(--paper)] font-mono text-xs tnum">{formatMsDateTime(s.startedAt, personaLocale)}</p>
                <p className="text-xs text-amber-400/90 font-mono">{s.reviewReason ?? "flagged"} · <span className="tnum">{s.totalMinutes ?? 0}</span> min</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBusyId(s._id);
                    if (s.userId) recompute({ userId: s.userId }).finally(() => setBusyId(null));
                  }}
                  disabled={busyId === s._id}
                  className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-[var(--paper)]"
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
                  className="btn-surgical-mint rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider"
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
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Audit log</h2>
      <div className="card-surgical overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-left text-xs uppercase tracking-wider text-[var(--paper-dimmer)] font-mono">
            <tr>
              <th scope="col" className="px-3 py-2">Time</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2 text-right">±m</th>
              <th scope="col" className="px-3 py-2 text-right">Skew s</th>
              <th scope="col" className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-center text-sm text-[var(--paper-dimmer)]">No audit entries in the last 7 days</td></tr>
            )}
            {(logs ?? []).map((l) => (
              <tr key={l._id} className="border-t border-[var(--line-subtle)] hover:bg-[var(--surface-raised)]/30 transition-colors" data-testid="audit-log-row">
                <td className="px-3 py-2 text-[var(--paper-dim)] font-mono text-xs tnum">{formatMsTime(l.at, personaLocale)}</td>
                <td className="px-3 py-2 text-[var(--paper)]">{l.status}</td>
                <td className="px-3 py-2 text-right text-[var(--paper-dim)] font-mono text-xs tnum">{l.accuracyMeters}</td>
                <td className="px-3 py-2 text-right text-[var(--paper-dim)] font-mono text-xs tnum">{Math.round(l.clockSkewMs / 1000)}</td>
                <td className="px-3 py-2 text-xs font-mono text-amber-400">
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
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Demo personas</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {(users ?? []).map((u) => (
          <li key={u._id} className="card-surgical p-3">
            <p className="text-sm font-medium text-[var(--paper)]">{u.name ?? u.email ?? "—"}</p>
            <p className="text-xs font-mono text-[var(--paper-dim)]">{u.email}</p>
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
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">My moderator messages</h2>
      {(inbox ?? []).length === 0 ? (
        <p className="text-sm text-[var(--paper-dimmer)]">No messages from this persona to the moderator queue.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inbox!.map((m) => (
            <li
              key={m._id}
              className="card-surgical p-3 text-sm"
              data-testid="message-row"
            >
              <p className="text-[var(--paper)]">{m.content}</p>
              <div className="mt-2 flex items-center justify-between text-xs font-mono text-[var(--paper-dim)]">
                <span className="tnum">{formatMsDateTime(m.at, personaLocale)}</span>
                {m.isRead ? (
                  <span className="text-[var(--paper-dimmer)] uppercase tracking-wider">read</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => markRead({ messageId: m._id as Id<"messages"> }).catch(() => {})}
                    className="btn-surgical rounded px-2.5 py-1 text-xs font-mono uppercase tracking-wider"
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
    <section data-testid="demo-export" className="card-surgical p-4">
      <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Export my logs</h2>
      <button
        type="button"
        onClick={() => void doExport()}
        disabled={busy}
        className="btn-surgical rounded px-3 py-2 text-xs font-mono uppercase tracking-wider text-[var(--paper)] disabled:opacity-50"
      >
        {busy ? "Building CSV…" : "Download CSV (last 14 days)"}
      </button>
      {message && <p className="mt-2 text-xs font-mono text-[var(--paper-dim)]">{message}</p>}
    </section>
  );
}
