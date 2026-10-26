"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
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
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employee Logging Dashboard</h1>
          <p className="text-sm text-neutral-400">Real-time overview of employee check-ins and payroll activity</p>
        </div>
        <a href="/moderator" className="text-sm text-emerald-400 underline hover:text-emerald-300">
          ← Back to moderator console
        </a>
      </header>

      <section className="mb-6" data-testid="dashboard-kpi-banner">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Active on site" value={summary?.activeOnSite ?? "—"} />
          <KpiCard label="Billable (7d)" value={summary ? formatMinutes(summary.weeklyBillableMinutes) : "—"} />
          <KpiCard label="Pending reviews" value={summary?.pendingReviews ?? "—"} />
          <KpiCard label="Anomalies (24h)" value={summary?.anomalies24h ?? "—"} />
        </div>
      </section>

      <section className="mb-6" data-testid="dashboard-audit">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent Check-ins</h2>
        {audit === undefined ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : audit.length === 0 ? (
          <p className="text-sm text-neutral-500">No recent check-ins</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2 text-right">Geofence</th>
                  <th className="px-3 py-2 text-right">Flags</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((row) => (
                  <tr key={row._id} className="border-t border-neutral-800" data-testid="dashboard-audit-row">
                    <td className="px-3 py-2">{row.employeeName}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2 text-neutral-400">{formatTime(row.at, locale)}</td>
                    <td className="px-3 py-2 text-neutral-400">{row.siteName}</td>
                    <td className={`px-3 py-2 text-right ${row.isWithinGeofence ? "text-emerald-400" : "text-red-400"}`}>
                      {row.isWithinGeofence ? "inside" : "outside"}
                    </td>
                    <td className="px-3 py-2 text-right text-red-400">
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
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Employee Roster</h2>
        {roster === undefined ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-neutral-500">No active employees</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Assigned Sites</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((emp) => (
                  <tr key={emp._id} className="border-t border-neutral-800" data-testid="dashboard-roster-row">
                    <td className="px-3 py-2">{emp.name ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-400">{emp.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${emp.isActive ? "bg-emerald-500/10 text-emerald-300" : "bg-neutral-800 text-neutral-500"}`}>
                        {emp.isActive ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-100">{value}</p>
    </div>
  );
}
