"use client";

import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/backend/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessagesPanel } from "../messages";
import { PayrollPanel, ReviewPanel } from "../payroll";
import { ChangePassword, ForcedPasswordChange } from "../change-password";
import { SiteMapPicker } from "../site-map-picker";
import { errMsg } from "@/lib/errors";
import { KpiBanner } from "./kpi-banner";
import { ActiveShiftsMap } from "./active-shifts-map";
import { GeofenceModal, type GeofenceFix } from "./geofence-modal";
import { formatDateTime } from "@/lib/format";
import { useUserLocale } from "@/lib/use-user-locale";
import { ConsoleWindow } from "@/components/console/window";
import { ConsoleTabs } from "@/components/console/console-tabs";
import { OrgProvider, useOrg } from "./org-context";
import { OrgPanel } from "./org-panel";
import { Pager } from "@/components/console/pager";
import { usePagination } from "@/components/console/use-pagination";

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
          <div role="tabpanel" aria-label="Live" className="flex h-full min-h-0 flex-col gap-2">
            <KpiBanner />
            <ActiveShiftsMap />
          </div>
        )}

        {view === "crew" && (
          <CrewView employees={employees ?? []} sites={sites ?? []} />
        )}

        {view === "access" && (
          <AccessView employees={(employees as any) ?? []} sites={sites ?? []} />
        )}

        {view === "payroll" && (
          <div role="tabpanel" aria-label="Payroll" className="grid h-full min-h-0 gap-2 md:grid-cols-5">
            <PayrollPanel employees={(employees ?? []) as never} role="moderator" className="md:col-span-3" />
            <ReviewPanel className="md:col-span-2" />
          </div>
        )}

        {view === "overrides" && (
          <div role="tabpanel" aria-label="Shift overrides" className="h-full min-h-0">
            <ShiftOverridePanel />
          </div>
        )}

        {view === "audit" && (
          <AuditView
            audit={audit ?? []}
            reviewCount={reviewCount}
            userLocale={userLocale}
            onMapFix={setGeofenceFix}
          />
        )}

        {view === "messages" && (
          <div role="tabpanel" aria-label="Messages" className="h-full min-h-0">
            <MessagesPanel role="moderator" />
          </div>
        )}
      </div>
      {geofenceFix && <GeofenceModal fix={geofenceFix} onClose={() => setGeofenceFix(null)} />}
    </main>
  );
}

/* ─────────────────────────── Crew (employees) ─────────────────────────── */

function CrewView({
  employees,
  sites,
}: {
  employees: any[];
  sites: { _id: string; name: string }[];
}) {
  const userLocale = useUserLocale();
  const table = usePagination(employees, 7);
  const cards = usePagination(employees, 4);
  const siteNames = (e: any) =>
    sites.filter((s) => e.assignedSiteIds?.includes(s._id)).map((s) => s.name).join(", ") || "—";

  return (
    <div role="tabpanel" aria-label="Crew" className="h-full min-h-0">
      <ConsoleWindow
        title={`Employees (${employees.length})`}
        className="h-full"
        bodyClassName="flex h-full min-h-0 flex-col p-2 sm:p-3"
      >
        {/* Desktop: dense table */}
        <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Name</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Email</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Sites</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Locale</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Rate/h</th>
                <th scope="col" className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {table.pageItems.map((e: any) => (
                <tr key={e._id} className="border-t border-[var(--line)]/60 transition hover:bg-[var(--panel-elevated)]/40">
                  <td className="px-3 py-2 font-medium text-[var(--paper)]">{e.name ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--fog)]">{e.email}</td>
                  <td className="max-w-[10rem] px-3 py-2 text-[var(--text-secondary)]">{siteNames(e)}</td>
                  <td className={`px-3 py-2 font-semibold ${e.archivedAt ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
                    {e.archivedAt ? "deactivated" : "active"}
                  </td>
                  <td className="px-3 py-2"><LocaleCell userId={e._id} initial={e.locale ?? "en-ZA"} /></td>
                  <td className="px-3 py-2"><RateCell userId={e._id} initial={e.hourlyRateOverride} /></td>
                  <td className="px-3 py-2 text-right">
                    {!e.archivedAt && (
                      <span className="inline-flex gap-2">
                        {e.deviceId && <ResetDeviceButton userId={e._id} />}
                        <DeactivateButton userId={e._id} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile: stacked cards, zero horizontal scroll */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:hidden">
          {cards.pageItems.map((e: any) => (
            <div key={e._id} className="card-subpanel flex-none px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--paper)]">{e.name ?? "—"}</span>
                <span className={`flex-none text-xs font-bold uppercase tracking-wider ${e.archivedAt ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
                  {e.archivedAt ? "deactivated" : "active"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--fog)]">{e.email} · {siteNames(e)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <LocaleCell userId={e._id} initial={e.locale ?? "en-ZA"} />
                <RateCell userId={e._id} initial={e.hourlyRateOverride} />
                {!e.archivedAt && (
                  <span className="ml-auto inline-flex gap-1.5">
                    {e.deviceId && <ResetDeviceButton userId={e._id} />}
                    <DeactivateButton userId={e._id} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <Pager
            page={table.page}
            pageCount={table.pageCount}
            total={table.total}
            onPage={table.setPage}
            label="Employees"
          />
        </div>
        <div className="md:hidden">
          <Pager
            page={cards.page}
            pageCount={cards.pageCount}
            total={cards.total}
            onPage={cards.setPage}
            label="Employees"
          />
        </div>
      </ConsoleWindow>
    </div>
  );
}

/* ───────────────────── Access (provision / sites / scopes) ───────────────────── */

type AccessTask = "provision" | "site" | "assign" | "managers" | "orgs";

function AccessView({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string; email?: string; archivedAt?: number; assignedSiteIds?: string[]; role?: string; orgId?: string }[];
  sites: { _id: string; name: string; orgId?: string }[];
}) {
  const [task, setTask] = useState<AccessTask>("provision");
  const { orgId } = useOrg();
  // Sites picked AFTER an org is created — everything below operates inside the selected org.
  const orgSites = orgId ? sites.filter((s) => s.orgId === orgId) : sites;
  const orgEmployees = orgId ? employees.filter((e) => e.orgId === orgId) : employees;
  const cell = (id: AccessTask) =>
    `min-h-0 h-full ${task === id ? "block" : "hidden"} md:block`;

  return (
    <div role="tabpanel" aria-label="Access" className="flex h-full min-h-0 flex-col">
      {/* Mobile: dropdown to pick which window to show */}
      <div className="mb-2 flex-none md:hidden">
        <label className="sr-only" htmlFor="access-task-select">Access task</label>
        <select
          id="access-task-select"
          data-testid="access-task-select"
          value={task}
          onChange={(e) => setTask(e.target.value as AccessTask)}
          className="input-surgical h-11 w-full px-3.5 text-sm font-semibold"
        >
          <option value="provision">Provision account + ID code</option>
          <option value="site">Create site (geofence)</option>
          <option value="assign">Assign employee ↔ sites</option>
          <option value="managers">Managers</option>
          <option value="orgs">Organisations</option>
        </select>
      </div>
      <div className={`${task === "orgs" ? "block" : "hidden"} mb-2 flex-none md:mb-2 md:block`}>
        <div className="h-44 md:h-36">
          <OrgPanel />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2 md:grid-rows-2">
        <div className={cell("provision")}>
          <ProvisionPanel />
        </div>
        <div className={cell("site")}>
          <SitePanel />
        </div>
        <div className={cell("assign")}>
          <AssignPanel employees={orgEmployees} sites={orgSites} />
        </div>
        <div className={cell("managers")}>
          <ManagersPanel employees={orgEmployees} sites={orgSites} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Audit log ───────────────────────────── */

function AuditView({
  audit,
  reviewCount,
  userLocale,
  onMapFix,
}: {
  audit: any[];
  reviewCount: number;
  userLocale: string;
  onMapFix: (fix: GeofenceFix) => void;
}) {
  const table = usePagination(audit, 7);
  const cards = usePagination(audit, 4);

  const rowActions = (l: any) => (
    <>
      {!l.isWithinGeofence && <span className="mr-1.5 font-semibold text-[var(--danger)]">geofence✗</span>}
      {l.impossibleTravelFlag && <span className="font-semibold text-[var(--danger)]">travel!</span>}
      {l.siteLat !== undefined && l.siteLng !== undefined && (
        <button
          onClick={() =>
            onMapFix({
              employeeName: l.employeeName,
              status: l.status,
              lat: l.lat,
              lng: l.lng,
              accuracyMeters: l.accuracyMeters,
              siteName: l.siteName,
              siteLat: l.siteLat!,
              siteLng: l.siteLng!,
              siteRadius: l.siteRadius ?? 0,
              isWithinGeofence: l.isWithinGeofence,
              impossibleTravelFlag: l.impossibleTravelFlag,
            })
          }
          aria-label={`Open geofence map for ${l.employeeName} at ${l.siteName}`}
          className="btn-surgical ml-2 rounded border-[var(--cyan)]/40 px-3 py-1 text-xs font-semibold text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
        >
          map
        </button>
      )}
    </>
  );

  return (
    <div role="tabpanel" aria-label="Audit log" className="h-full min-h-0">
      <ConsoleWindow
        title="Audit log · 7 days"
        className="h-full"
        bodyClassName="flex h-full min-h-0 flex-col p-2 sm:p-3"
        aside={
          reviewCount > 0 ? (
            <span
              role="status"
              aria-live="polite"
              className="rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]"
            >
              {reviewCount} need review
            </span>
          ) : undefined
        }
      >
        {/* Desktop table */}
        <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--line)] md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Time (client)</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Employee</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Site</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">±m</th>
                <th scope="col" className="px-3 py-2 text-right text-xs uppercase tracking-wider">Skew</th>
                <th scope="col" className="px-3 py-2 text-xs uppercase tracking-wider">Flags</th>
              </tr>
            </thead>
            <tbody>
              {table.pageItems.map((l: any) => (
                <tr key={l._id} className="border-t border-[var(--line)]/60 transition hover:bg-[var(--panel-elevated)]/40">
                  <td className="tnum px-3 py-2 font-medium text-[var(--paper)]">{formatDateTime(l.at, userLocale)}</td>
                  <td className="px-3 py-2 font-medium">{l.employeeName}</td>
                  <td className="px-3 py-2 text-[var(--fog)]">{l.siteName}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{l.status}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--fog)]">{l.accuracyMeters}</td>
                  <td className={`tnum px-3 py-2 text-right ${(Math.abs(l.clockSkewMs) > 30000) ? "font-semibold text-[var(--hivis)]" : "text-[var(--fog)]"}`}>
                    {Math.round(l.clockSkewMs / 1000)}s
                  </td>
                  <td className="px-3 py-2">{rowActions(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:hidden">
          {cards.pageItems.map((l: any) => (
            <div key={l._id} className="card-subpanel flex-none px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tnum font-semibold text-[var(--paper)]">{formatDateTime(l.at, userLocale)}</span>
                <span className="truncate font-medium text-[var(--text-secondary)]">{l.employeeName}</span>
              </div>
              <p className="mt-0.5 truncate text-[var(--fog)]">{l.siteName} · {l.status} · ±{l.accuracyMeters}m · skew {Math.round(l.clockSkewMs / 1000)}s</p>
              <div className="mt-1">{rowActions(l)}</div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <Pager page={table.page} pageCount={table.pageCount} total={table.total} onPage={table.setPage} label="Audit rows" />
        </div>
        <div className="md:hidden">
          <Pager page={cards.page} pageCount={cards.pageCount} total={cards.total} onPage={cards.setPage} label="Audit rows" />
        </div>
      </ConsoleWindow>
    </div>
  );
}

/* ─────────────────────────── Provision panel ─────────────────────────── */

function ProvisionPanel() {
  const provisionEmployeeAction = useAction(api.users.provisionEmployee);
  const provisionModeratorAction = useAction(api.users.provisionModerator);
  const { orgId } = useOrg();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "moderator">("employee");
  const [code, setCode] = useState<{ email: string; idCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ConsoleWindow
      title="Provision account"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-3"
      aside={<span className="text-xs text-[var(--fog)]">{orgId ? "lands in selected org" : "no org selected — account will be unscoped"}</span>}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="input-surgical px-3.5 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
          className="input-surgical px-3.5 py-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "moderator")}
          className="input-surgical px-3.5 py-2 text-sm">
          <option value="employee">Employee</option>
          <option value="moderator">Moderator</option>
        </select>
      </label>
      <button
        data-loading={busy}
        aria-busy={busy}
        disabled={busy || !name || !email}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const fn = role === "employee" ? provisionEmployeeAction : provisionModeratorAction;
            setCode(
              role === "employee"
                ? await fn({ name, email, orgId: orgId ?? undefined } as { name: string; email: string })
                : await fn({ name, email })
            );
            if (role === "employee" && typeof window !== "undefined") {
              (window as unknown as { __JPAY_LAST_EMPLOYEE_EMAIL?: string }).__JPAY_LAST_EMPLOYEE_EMAIL = email;
            }
            setName("");
            setEmail("");
          } catch (e) {
            setError(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
        className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        <span className="btn-label">Create account + ID code ({role})</span>
        <span className="btn-spinner" aria-hidden="true" />
      </button>
      {error && <p className="flex-none text-xs text-[var(--danger)]">{error}</p>}
      {code && (
        <div className="card-subpanel flex-none border-[var(--mint)]/60 bg-[var(--mint)]/10 p-2.5 text-xs text-[var(--paper)]">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--mint)]">Shown once — hand over NOW:</p>
          <p className="truncate">Email: <strong>{code.email}</strong></p>
          <p>ID code: <strong className="tnum font-mono tracking-widest text-[var(--mint)]">{code.idCode}</strong></p>
          <button
            onClick={() => navigator.clipboard.writeText(`${code.email}: ${code.idCode}`)}
            className="btn-surgical mt-1.5 px-3 py-1 text-xs font-semibold border-[var(--mint)]/40 text-[var(--mint)] hover:bg-[var(--mint)]/10"
          >
            copy
          </button>
        </div>
      )}
    </ConsoleWindow>
  );
}

/* ─────────────────────────── Create site panel ─────────────────────────── */

function SitePanel() {
  const createSite = useMutation(api.sites.createSite);
  const { orgId } = useOrg();
  const [form, setForm] = useState({ name: "", lat: "", lng: "", radius: "150", tz: "Africa/Johannesburg" });
  const coord = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const latNum = coord(form.lat);
  const lngNum = coord(form.lng);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <ConsoleWindow
      title="Create site"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-2 p-2 md:flex-row md:p-3"
      aside={<span className="text-xs text-[var(--fog)]">{orgId ? "inside selected org" : "create an org first"}</span>}
    >
      <div className="flex min-h-0 flex-none flex-col md:w-[46%] md:flex-none">
        <SiteMapPicker lat={latNum} lng={lngNum} onPick={(a, b) => setForm({ ...form, lat: String(a), lng: String(b) })} />
      </div>
      <div className="grid flex-none grid-cols-2 content-start gap-1.5 md:min-h-0 md:flex-1 md:gap-2">
        <label className="col-span-2 flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Latitude</span>
          <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Latitude" inputMode="decimal"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Longitude</span>
          <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="Longitude" inputMode="decimal"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Radius m</span>
          <input value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="Radius m"
            inputMode="numeric" className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">Timezone</span>
          <input value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} placeholder="IANA timezone"
            className="input-surgical px-3 py-1.5 text-sm" />
        </label>
        {!orgId && (
          <p className="col-span-2 flex-none text-xs text-[var(--hivis)]">
            Create or select an organisation above first — sites belong to an org.
          </p>
        )}
        <button
          data-loading={busy}
          aria-busy={busy}
          disabled={busy || !orgId}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await createSite({
                name: form.name,
                latitude: Number(form.lat),
                longitude: Number(form.lng),
                geofenceRadiusMeters: Number(form.radius),
                timezone: form.tz,
                orgId: orgId as never,
              });
              setMsg(`Created ${form.name}`);
              setForm({ ...form, name: "", lat: "", lng: "" });
            } catch (e) {
              setMsg(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-surgical col-span-2 min-h-[44px] flex-none px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create site</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
        {msg && <p className="col-span-2 flex-none truncate text-xs text-[var(--fog)]">{msg}</p>}
      </div>
    </ConsoleWindow>
  );
}

/* ─────────────────────────── Managers panel ─────────────────────────── */

function ManagersPanel({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string; email?: string; archivedAt?: number; role?: string }[];
  sites: { _id: string; name: string }[];
}) {
  const managers = useQuery(api.manager.listManagers) as
    | { _id: string; name?: string; email?: string; isActive: boolean; managedSiteIds: string[]; managedSiteNames: string[] }[]
    | undefined;
  const promote = useMutation(api.manager.promoteToManager);
  const demote = useMutation(api.manager.demoteManager);
  const setSites = useMutation(api.manager.setManagerSites);
  const [promoteUserId, setPromoteUserId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const promotable = employees.filter((e) => !e.archivedAt && e.role === "employee");
  const paged = usePagination(managers ?? [], 2);
  const sitePage = usePagination(sites, 4);

  const openEditor = (m: { _id: string; managedSiteIds: string[] }) => {
    setOpenId(m._id);
    setChecked(new Set(m.managedSiteIds));
    setMsg(null);
  };

  return (
    <ConsoleWindow
      title="Managers"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-1.5 p-3"
      aside={<span className="text-xs text-[var(--fog)]">scoped crew access · no payroll rights</span>}
    >
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--line)] pb-2">
        <select value={promoteUserId} onChange={(e) => setPromoteUserId(e.target.value)}
          aria-label="Employee to promote"
          className="input-surgical min-w-0 flex-1 px-3 py-2 text-xs">
          <option value="">Employee to promote…</option>
          {promotable.map((e) => (
            <option key={e._id} value={e._id}>{e.name ?? e.email}{e.role === "manager" ? " (manager)" : ""}</option>
          ))}
        </select>
        <button
          disabled={!promoteUserId}
          onClick={async () => {
            setMsg(null);
            try {
              await promote({ userId: promoteUserId as never });
              setPromoteUserId("");
              setMsg("Promoted to manager.");
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          Promote
        </button>
      </div>
      {msg && <p className="flex-none truncate text-xs font-medium text-[var(--paper)]">{msg}</p>}

      <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
        {paged.pageItems.map((m) => (
          <li key={m._id} className="flex-none rounded-lg border border-[var(--line)] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--paper)]">{m.name ?? m.email}</span>
                <span className="block truncate text-xs text-[var(--text-secondary)]">
                  {!m.isActive && <span className="mr-1 font-semibold text-[var(--danger)]">deactivated ·</span>}
                  {m.managedSiteNames.length > 0 ? m.managedSiteNames.join(", ") : "no sites scoped"}
                </span>
              </div>
              <span className="inline-flex flex-none gap-1.5">
                <button
                  onClick={() => (openId === m._id ? setOpenId(null) : openEditor(m))}
                  className="btn-surgical min-h-[40px] px-2.5 py-1.5 text-xs font-semibold border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
                >
                  {openId === m._id ? "Close" : "Sites"}
                </button>
                <button
                  onClick={async () => {
                    setMsg(null);
                    try {
                      await demote({ userId: m._id as never });
                      setMsg("Demoted to employee.");
                    } catch (e) {
                      setMsg(errMsg(e));
                    }
                  }}
                  className="btn-surgical min-h-[40px] px-2.5 py-1.5 text-xs font-semibold border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                >
                  Demote
                </button>
              </span>
            </div>
            {openId === m._id && (
              <div className="mt-1.5 flex flex-col gap-1.5 border-t border-[var(--line)] pt-1.5">
                <div className="flex flex-none flex-col gap-1">
                  {sitePage.pageItems.map((s) => {
                    const on = checked.has(s._id);
                    return (
                      <label key={s._id} className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--mint)]"
                          checked={on}
                          onChange={() => {
                            const next = new Set(checked);
                            if (on) next.delete(s._id); else next.add(s._id);
                            setChecked(next);
                          }}
                        />
                        <span className="truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
                <Pager page={sitePage.page} pageCount={sitePage.pageCount} total={sitePage.total} onPage={sitePage.setPage} label="Sites" />
                <button
                  onClick={async () => {
                    setMsg(null);
                    try {
                      const result = await setSites({
                        managerId: m._id as never,
                        siteIds: [...checked] as never,
                      });
                      setMsg(`Saved — manager covers ${result.total} site${result.total === 1 ? "" : "s"}.`);
                    } catch (e) {
                      setMsg(errMsg(e));
                    }
                  }}
                  className="btn-surgical btn-surgical-mint min-h-[44px] flex-none px-4 py-2 text-xs font-semibold"
                >
                  Save sites
                </button>
              </div>
            )}
          </li>
        ))}
        {managers !== undefined && managers.length === 0 && (
          <li className="flex-none text-xs text-[var(--fog)]">No managers yet.</li>
        )}
      </ul>
      <Pager page={paged.page} pageCount={paged.pageCount} total={paged.total} onPage={paged.setPage} label="Managers" />
    </ConsoleWindow>
  );
}

/* ─────────────────────────── Assign panel ─────────────────────────── */

function AssignPanel({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string; email?: string; archivedAt?: number; assignedSiteIds?: string[]; role?: string }[];
  sites: { _id: string; name: string }[];
}) {
  const setAssignments = useMutation(api.sites.setEmployeeSites);
  const [userId, setUserId] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const active = employees.filter((e) => !e.archivedAt);
  const sitePage = usePagination(sites, 5);

  // Initialize the checklist from the employee's current assignments.
  const applySelection = (nextUserId: string) => {
    setUserId(nextUserId);
    setMsg(null);
    const emp = employees.find((e) => e._id === nextUserId);
    setChecked(new Set(emp?.assignedSiteIds ?? []));
  };

  return (
    <ConsoleWindow title="Assign employee ↔ sites" className="h-full" bodyClassName="flex min-h-0 flex-col gap-2 p-3">
      <select value={userId} onChange={(e) => applySelection(e.target.value)}
        aria-label="Employee to assign"
        className="input-surgical w-full flex-none px-3.5 py-2 text-sm">
        <option value="">Employee…</option>
        {active.map((e: any) => (
          <option key={e._id} value={e._id}>{e.name ?? e.email}{e.role === "manager" ? " (manager)" : ""}</option>
        ))}
      </select>
      {userId && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          {sites.length === 0 && <p className="p-2 text-xs text-[var(--fog)]">No sites yet.</p>}
          {sitePage.pageItems.map((s: any) => {
            const on = checked.has(s._id);
            return (
              <label key={s._id} className="flex min-h-[44px] flex-none cursor-pointer items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--mint)]"
                  checked={on}
                  onChange={() => {
                    const next = new Set(checked);
                    if (on) next.delete(s._id); else next.add(s._id);
                    setChecked(next);
                  }}
                />
                <span className="truncate">{s.name}</span>
              </label>
            );
          })}
          <Pager page={sitePage.page} pageCount={sitePage.pageCount} total={sitePage.total} onPage={sitePage.setPage} label="Sites" />
        </div>
      )}
      <div className="flex flex-none items-center gap-2.5">
        <button
          disabled={!userId}
          onClick={async () => {
            setMsg(null);
            try {
              const result = await setAssignments({
                userId: userId as never,
                siteIds: [...checked] as never,
              });
              setMsg(`Saved — ${result.total} site${result.total === 1 ? "" : "s"} assigned (+${result.assigned} / −${result.unassigned}).`);
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save assignments
        </button>
      </div>
      {msg && <p className="flex-none truncate text-xs font-medium text-[var(--paper)]">{msg}</p>}
    </ConsoleWindow>
  );
}

/* ─────────────────────────── Shift overrides ─────────────────────────── */

type OverridableShift = {
  _id: string;
  employeeName: string;
  startedAt: number;
  endedAt?: number;
  totalMinutes?: number;
  needsReview: boolean;
  reviewReason?: string;
  hasOverride: boolean;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function ShiftOverridePanel() {
  const shifts = useQuery(api.moderator.overridableShifts) as OverridableShift[] | undefined;
  const override = useMutation(api.moderator.endShiftOverride);
  const userLocale = useUserLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = usePagination(shifts ?? [], 3);

  const openEditor = (row: OverridableShift) => {
    setOpenId(row._id);
    setWhen(toLocalInput(row.endedAt ?? row.startedAt + 8 * 3600 * 1000));
    setReason("");
    setMsg(null);
  };

  return (
    <ConsoleWindow
      title="Shift overrides · forgotten log-off"
      className="h-full"
      bodyClassName="flex min-h-0 flex-col gap-1.5 p-3"
      aside={<span className="hidden text-xs text-[var(--fog)] sm:inline">reason required · audited</span>}
    >
      {shifts === undefined && <p className="flex-none text-xs text-[var(--fog)]">Loading…</p>}
      {shifts !== undefined && shifts.length === 0 && (
        <p className="flex-none text-xs text-[var(--fog)]">No unsealed shifts in the last 14 days.</p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
        {list.pageItems.map((row) => (
          <li key={row._id} className="flex-none rounded-lg border border-[var(--line)] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-xs">
                <span className="font-medium text-[var(--paper)]">{row.employeeName}</span>
                <span className="ml-2 tnum text-xs text-[var(--text-secondary)]">
                  {formatDateTime(row.startedAt, userLocale)} →{" "}
                  {row.endedAt ? formatDateTime(row.endedAt, userLocale) : "open"}
                </span>
                {row.needsReview && (
                  <span className="ml-2 rounded-full border border-[var(--amber,#fbbf24)]/40 px-1.5 py-0.5 text-xs text-[var(--amber,#fbbf24)]">
                    {row.hasOverride ? "overridden" : "needs review"}
                  </span>
                )}
                {!row.endedAt && (
                  <span className="ml-2 rounded-full border border-[var(--mint)]/40 px-1.5 py-0.5 text-xs text-[var(--mint)]">forgot log-off?</span>
                )}
              </div>
              <button
                onClick={() => (openId === row._id ? setOpenId(null) : openEditor(row))}
                className="btn-surgical min-h-[40px] flex-none px-2.5 py-1.5 text-xs font-semibold border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
              >
                {openId === row._id ? "Close" : "Override end"}
              </button>
            </div>
            {openId === row._id && (
              <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-[var(--line)] p-2">
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Corrected end (local time)
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="input-surgical px-3 py-1.5 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
                  Reason (required, min 10 characters) — audited
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Employee called in — forgot to log off, left site at 17:30"
                    className="input-surgical px-3 py-1.5 text-xs"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={busy || !when || reason.trim().length < 10}
                    onClick={async () => {
                      setBusy(true);
                      setMsg(null);
                      try {
                        await override({
                          shiftId: row._id as never,
                          endedAt: new Date(when).getTime(),
                          reason: reason.trim(),
                        });
                        setMsg("Override saved — shift re-derives, payroll reflects the change.");
                      } catch (e) {
                        setMsg(errMsg(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="btn-surgical btn-surgical-mint min-h-[40px] px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Save override"}
                  </button>
                  {msg && <span className="min-w-0 truncate text-xs font-medium text-[var(--paper)]">{msg}</span>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pager page={list.page} pageCount={list.pageCount} total={list.total} onPage={list.setPage} label="Shifts" />
    </ConsoleWindow>
  );
}

/* ─────────────────────── Small action cells ─────────────────────── */

function DeactivateButton({ userId }: { userId: string }) {
  const deactivate = useMutation(api.users.deactivateEmployee);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return confirming ? (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() =>
          void deactivate({ userId: userId as Id<"users"> })
            .then(() => setConfirming(false))
            .catch((e) => setError(errMsg(e)))
        }
        className="btn-surgical rounded border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)]"
      >
        confirm
      </button>
      <button onClick={() => { setConfirming(false); setError(null); }} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
      {error && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{error}</span>}
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)] hover:text-[var(--danger)]">
      deactivate
    </button>
  );
}

function LocaleCell({ userId, initial }: { userId: Id<"users">; initial: string }) {
  const setUserLocale = useMutation(api.users.setUserLocale);
  const [localeError, setLocaleError] = useState<string | null>(null);
  const LOCALES = ["en-ZA", "en-US", "en-GB", "en-AU", "es-ES", "fr-FR"] as const;
  return (
    <select
      defaultValue={initial}
      onChange={(e) =>
        void setUserLocale({ userId, locale: e.target.value as (typeof LOCALES)[number] }).catch(
          (err) => setLocaleError(errMsg(err))
        )
      }
      aria-label={localeError ? `Locale for ${userId} — ${localeError}` : `Locale for ${userId}`}
      title={localeError ?? undefined}
      className="input-surgical px-2 py-1.5 text-xs"
    >
      {LOCALES.map((l: any) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

function RateCell({ userId, initial }: { userId: Id<"users">; initial?: number }) {
  const setRate = useMutation(api.moderator.setHourlyOverride);
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [saved, setSaved] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const inputId = `rate-${userId}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">
        Hourly rate
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        inputMode="decimal"
        min={0}
        placeholder="default"
        className="input-surgical tnum w-16 px-2 py-1 text-right text-xs"
      />
      <button
        onClick={async () => {
          const n = value.trim() === "" ? undefined : Number(value);
          if (value.trim() !== "" && Number.isNaN(n)) return;
          try {
            await setRate({ userId, rate: n });
            setSaved(true);
            setRateError(null);
          } catch (e) {
            setRateError(errMsg(e));
          }
        }}
        aria-label={saved ? `Rate saved for ${userId}` : `Set hourly rate for ${userId}`}
        className="btn-surgical rounded px-2 py-1 text-xs font-medium"
      >
        {saved ? "✓" : "set"}
      </button>
      {rateError && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{rateError}</span>}
    </span>
  );
}

function ResetDeviceButton({ userId }: { userId: Id<"users"> }) {
  const reset = useMutation(api.users.resetDeviceToken);
  const [confirming, setConfirming] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  return confirming ? (
    <span className="inline-flex gap-1">
      <button
        onClick={() =>
          void reset({ userId })
            .then(() => setConfirming(false))
            .catch((e) => setResetError(errMsg(e)))
        }
        className="btn-surgical rounded border-[var(--hivis)]/40 px-2 py-1 text-xs text-[var(--hivis)]"
      >
        confirm
      </button>
      <button onClick={() => { setConfirming(false); setResetError(null); }} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
      {resetError && <span role="alert" className="max-w-[10rem] truncate text-xs text-[var(--danger)]">{resetError}</span>}
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2 py-1 text-xs text-[var(--fog)] hover:text-[var(--hivis)]">
      reset device
    </button>
  );
}
