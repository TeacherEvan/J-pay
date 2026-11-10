"use client";

import { useQuery } from "@/lib/backend/react";
import Link from "next/link";
import { api } from "@/lib/backend/api";
import { ChangePassword, ForcedPasswordChange } from "../change-password";
import { ManagerMap } from "./manager-map";

type CrewRow = {
  _id: string;
  name: string;
  email?: string;
  role: "employee" | "manager";
  assignedSiteNames: string[];
  onShift: { _id: string; startedAt: number } | null;
};
type SiteRow = { _id: string; name: string };
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";

export default function ManagerPage() {
  const me = useQuery(api.users_queries.me);
  const crew = useQuery(api.manager.myCrew, {}) as CrewRow[] | undefined;
  const managedSites = useQuery(api.manager.listManagedSites, {}) as SiteRow[] | undefined;
  const userLocale = useUserLocale();

  if (me === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center text-sm text-[var(--fog)]">
        <div className="flex flex-col items-center gap-3">
          <svg className="jpay-loader-emblem h-10 w-10 text-[var(--mint)]" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 4" />
            <circle cx="20" cy="20" r="6" fill="currentColor" />
          </svg>
          <span>Loading…</span>
        </div>
      </main>
    );
  }
  if (me !== null && me !== undefined && me.passwordChangedAt === undefined) {
    return <ForcedPasswordChange />;
  }
  if (me === null || me.role !== "manager") {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-sm text-[var(--fog)]">
        <div>
          <p>Manager access only.</p>
          <Link href="/" className="mt-2 inline-block text-[var(--mint)] underline hover:brightness-110">
            Back to check-in
          </Link>
        </div>
      </main>
    );
  }

  const onShiftCount = (crew ?? []).filter((c) => c.onShift).length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--paper)]">Manager console</h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Crew scoped to your assigned sites · live travel &amp; on-site status
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/" className="min-h-[44px] inline-flex items-center text-xs text-[var(--fog)] underline hover:text-[var(--paper)]">
            ← check-in
          </Link>
          <ChangePassword />
        </div>
      </header>

      <ManagerMap />

      <section className="card-surgical p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
          My sites ({(managedSites ?? []).length}) · crew of {(crew ?? []).length} · {onShiftCount} on shift
        </h2>
        {managedSites !== undefined && managedSites.length === 0 && (
          <p className="text-sm text-[var(--fog)]">
            No sites assigned to you yet — ask your moderator to scope you to sites.
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {(managedSites ?? []).map((s) => (
            <li key={s._id} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--paper)]">
              {s.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
            <tr>
              <th scope="col" className="p-3 text-xs uppercase tracking-wider">Name</th>
              <th scope="col" className="p-3 text-xs uppercase tracking-wider">Sites</th>
              <th scope="col" className="p-3 text-xs uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {(crew ?? []).map((c) => (
              <tr key={c._id} className="border-t border-[var(--line)]/60">
                <td className="p-3 font-medium text-[var(--paper)]">
                  {c.name}
                  {c.role === "manager" && (
                    <span className="ml-2 rounded-full border border-[var(--cyan)]/40 px-1.5 py-0.5 text-xs uppercase tracking-wider text-[var(--cyan)]">manager</span>
                  )}
                </td>
                <td className="p-3 text-[var(--text-secondary)]">{c.assignedSiteNames.join(", ") || "—"}</td>
                <td className="p-3">
                  {c.onShift ? (
                    <span className="text-[var(--mint)]">
                      on shift since {formatDateTime(c.onShift.startedAt, userLocale)}
                    </span>
                  ) : (
                    <span className="text-[var(--fog)]">off shift</span>
                  )}
                </td>
              </tr>
            ))}
            {crew !== undefined && crew.length === 0 && (
              <tr><td colSpan={3} className="p-4 text-center text-[var(--fog)]">No crew on your sites yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
