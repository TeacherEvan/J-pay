"use client";

import { useQuery } from "@/lib/backend/react";
import Link from "next/link";
import { api } from "@/lib/backend/api";
import { useUserLocale } from "@/lib/use-user-locale";
import { formatCurrency, formatTime } from "@/lib/format";
import { ForcedPasswordChange } from "../change-password";

function formatMinutes(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min.toString().padStart(2, "0")}m` : `${min}m`;
}

export default function DashboardPage() {
  const me = useQuery(api.users_queries.me);
  const locale = useUserLocale();
  const summary = useQuery(api.kpi.summary, me?.role === "moderator" ? {} : "skip");
  const audit = useQuery(
    api.moderator.auditRecentLogs,
    me?.role === "moderator" ? { limit: 100 } : "skip"
  );
  const roster = useQuery(
    api.moderator.listEmployeesWithAssignments,
    me?.role === "moderator" ? {} : "skip"
  );

  if (me === undefined) {
    return <main className="grid min-h-dvh place-items-center text-sm text-neutral-400">Loading…</main>;
  }
  if (me !== null && me.passwordChangedAt === undefined && !me.isMasterTemp) {
    return <ForcedPasswordChange />;
  }
  if (me === null || me.role !== "moderator") {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-sm text-neutral-400">
        Moderator access only.
        <Link href="/" className="mt-2 text-emerald-400 underline">
          Back to check-in
        </Link>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6" data-testid="dashboard-page">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--line)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--paper)]">Employee Logging Dashboard</h1>
          <p className="text-xs text-[var(--paper-dim)]">Real-time overview of employee check-ins and payroll activity</p>
        </div>
        <Link href="/moderator" className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-emerald-400">
          ← Back to moderator console
        </Link>
      </header>

      <section className="mb-6" data-testid="dashboard-kpi-banner">
        {/* Key Metrics: tabular-nums (tnum) numeric readouts */}
        <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 tnum">
          <KpiCard label="Active on site" value={summary?.activeOnSite ?? "—"} />
          <KpiCard label="Billable (7d)" value={summary ? formatMinutes(summary.weeklyBillableMinutes) : "—"} />
          <KpiCard label="Pending reviews" value={summary?.pendingReviews ?? "—"} />
          <KpiCard label="Anomalies (24h)" value={summary?.anomalies24h ?? "—"} />
        </div>
      </section>

      <section className="mb-6" data-testid="dashboard-audit">
        <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Recent Check-ins</h2>
        {audit === undefined ? (
          <p className="text-sm text-[var(--paper-dimmer)]">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="text-sm text-[var(--paper-dimmer)]">No recent check-ins</p>
        ) : (
          <div className="card-surgical overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-left text-xs uppercase tracking-wider text-[var(--paper-dimmer)] font-mono">
                <tr>
                  <th scope="col" className="px-3 py-2">Employee</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Time</th>
                  <th scope="col" className="px-3 py-2">Site</th>
                  <th scope="col" className="px-3 py-2 text-right">Geofence</th>
                  <th scope="col" className="px-3 py-2 text-right">Flags</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((row: any) => (
                  <tr key={row._id} className="border-t border-[var(--line-subtle)] hover:bg-[var(--surface-raised)]/30 transition-colors" data-testid="dashboard-audit-row">
                    <td className="px-3 py-2 font-medium text-[var(--paper)]">{row.employeeName}</td>
                    <td className="px-3 py-2 text-[var(--paper-dim)]">{row.status}</td>
                    <td className="px-3 py-2 text-[var(--paper-dim)] font-mono text-xs tnum">{formatTime(row.at, locale)}</td>
                    <td className="px-3 py-2 text-[var(--paper-dim)]">{row.siteName}</td>
                    <td className={`px-3 py-2 text-right font-medium text-xs ${row.isWithinGeofence ? "text-emerald-400" : "text-red-400"}`}>
                      {row.isWithinGeofence ? "inside" : "outside"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-red-400 font-medium">
                      {row.impossibleTravelFlag ? "travel" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section data-testid="dashboard-roster">
        <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Employee Roster</h2>
        {roster === undefined ? (
          <p className="text-sm text-[var(--paper-dimmer)]">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-[var(--paper-dimmer)]">No active employees</p>
        ) : (
          <div className="card-surgical overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--line)] bg-[var(--surface-sunken)] text-left text-xs uppercase tracking-wider text-[var(--paper-dimmer)] font-mono">
                <tr>
                  <th scope="col" className="px-3 py-2">Name</th>
                  <th scope="col" className="px-3 py-2">Email</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Assigned Sites</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((emp: any) => (
                  <tr key={emp._id} className="border-t border-[var(--line-subtle)] hover:bg-[var(--surface-raised)]/30 transition-colors" data-testid="dashboard-roster-row">
                    <td className="px-3 py-2 font-medium text-[var(--paper)]">{emp.name ?? "—"}</td>
                    <td className="px-3 py-2 text-[var(--paper-dim)] font-mono text-xs">{emp.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${emp.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-neutral-800 text-[var(--paper-dimmer)] border-neutral-700"}`}>
                        {emp.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--paper-dim)]">
                      {emp.siteNames.length > 0 ? emp.siteNames.join(", ") : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card-surgical p-3">
      <p className="text-xs font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--paper)] tnum font-mono">{value}</p>
    </div>
  );
}
