"use client";

import { useQuery } from "@/lib/backend/react";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/backend/api";
import { MessagesPanel } from "../messages";
import { PayrollPanel, ReviewPanel } from "../payroll";
import { ChangePassword, ForcedPasswordChange } from "../change-password";
import { KpiBanner } from "./kpi-banner";
import { ActiveShiftsMap } from "./active-shifts-map";
import { GeofenceModal, type GeofenceFix } from "./geofence-modal";
import { useUserLocale } from "@/lib/use-user-locale";
import { ConsoleTabs } from "@/components/console/console-tabs";
import { OrgProvider } from "./org-context";
import { CrewView } from "./crew-view";
import { AccessView } from "./access-view";
import { AuditView } from "./audit-view";
import { ShiftOverridePanel } from "./shift-overrides-panel";
import type { AuditLogRow, ModeratorEmployee } from "./types";

type ViewId = "live" | "crew" | "access" | "payroll" | "overrides" | "audit" | "messages";

export default function ModeratorPage() {
  return (
    <OrgProvider>
      <ModeratorConsole />
    </OrgProvider>
  );
}

function ModeratorConsole() {
  const me = useQuery(api.users_queries.me);
  const employees = useQuery(api.moderator.listEmployeesWithAssignments);
  const sites = useQuery(api.moderator.listAllSites);
  const audit = useQuery(api.moderator.auditRecentLogs, { limit: 50 });
  const [geofenceFix, setGeofenceFix] = useState<GeofenceFix | null>(null);
  const review = useQuery(api.moderator.auditNeedsReview);
  const userLocale = useUserLocale();
  const [view, setView] = useState<ViewId>("live");

  if (me === undefined) {
    return (
      <main className="grid h-dvh place-items-center text-sm text-[var(--fog)]">
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
  if (me === null || me.role !== "moderator") {
    return (
      <main className="grid h-dvh place-items-center p-6 text-center text-sm text-[var(--fog)]">
        <div>
          <p>Moderator access only.</p>
          <Link href="/" className="mt-2 inline-block text-[var(--mint)] underline hover:brightness-110">
            Back to check-in
          </Link>
        </div>
      </main>
    );
  }

  const reviewCount = (review ?? []).length;
  const tabs = [
    { id: "live", label: "Live" },
    { id: "crew", label: "Crew" },
    { id: "access", label: "Access" },
    { id: "payroll", label: "Payroll" },
    { id: "overrides", label: "Overrides" },
    { id: "audit", label: "Audit", badge: reviewCount > 0 ? reviewCount : undefined },
    { id: "messages", label: "Messages" },
  ];

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--ink)] md:h-dvh md:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--hivis)]">
            J-Pay · Moderator Ops
          </p>
          <h1 className="text-lg font-bold leading-tight tracking-tight text-[var(--paper)] sm:text-xl">
            Moderator console
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            className="btn-surgical inline-flex min-h-[44px] items-center border-[var(--mint)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--mint)] hover:bg-[var(--mint)]/10"
          >
            Logging dashboard →
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center text-xs text-[var(--fog)] underline hover:text-[var(--paper)]"
          >
            employee view
          </Link>
          <ChangePassword />
        </div>
      </header>

      <ConsoleTabs
        tabs={tabs}
        active={view}
        onChange={(id) => setView(id as ViewId)}
        ariaLabel="Moderator console view"
      />

      <div className="p-2 sm:p-3 md:min-h-0 md:flex-1">
        {view === "live" && (
          <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live" aria-label="Live" className="flex h-full min-h-0 flex-col gap-2">
            <KpiBanner />
            <ActiveShiftsMap />
          </div>
        )}

        {view === "crew" && (
          <CrewView employees={employees ?? []} loading={employees === undefined} sites={sites ?? []} />
        )}

        {view === "access" && (
          <AccessView employees={(employees as any) ?? []} sites={sites ?? []} />
        )}

        {view === "payroll" && (
          <div role="tabpanel" id="tabpanel-payroll" aria-labelledby="tab-payroll" aria-label="Payroll" className="grid h-full min-h-0 gap-2 md:grid-cols-5">
            <PayrollPanel employees={(employees ?? []) as never} role="moderator" className="md:col-span-3" />
            <ReviewPanel className="md:col-span-2" />
          </div>
        )}

        {view === "overrides" && (
          <div role="tabpanel" id="tabpanel-overrides" aria-labelledby="tab-overrides" aria-label="Shift overrides" className="h-full min-h-0">
            <ShiftOverridePanel />
          </div>
        )}

        {view === "audit" && (
          <AuditView
            audit={(audit ?? []) as AuditLogRow[]}
            reviewCount={reviewCount}
            userLocale={userLocale}
            onMapFix={setGeofenceFix}
          />
        )}

        {view === "messages" && (
          <div role="tabpanel" id="tabpanel-messages" aria-labelledby="tab-messages" aria-label="Messages" className="h-full min-h-0">
            <MessagesPanel role="moderator" />
          </div>
        )}
      </div>
      {geofenceFix && <GeofenceModal fix={geofenceFix} onClose={() => setGeofenceFix(null)} />}
    </main>
  );
}

