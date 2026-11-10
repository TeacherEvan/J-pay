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

export default function ModeratorPage() {
  const me = useQuery(api.users_queries.me);
  const employees = useQuery(api.moderator.listEmployeesWithAssignments);
  const sites = useQuery(api.moderator.listAllSites);
  const audit = useQuery(api.moderator.auditRecentLogs, { limit: 50 });
  const [geofenceFix, setGeofenceFix] = useState<GeofenceFix | null>(null);
  const review = useQuery(api.moderator.auditNeedsReview);
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
  if (me === null || me.role !== "moderator") {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-sm text-[var(--fog)]">
        <div>
          <p>Moderator access only.</p>
          <Link href="/" className="mt-2 inline-block text-[var(--mint)] underline hover:brightness-110">
            Back to check-in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6">
      <KpiBanner />
      <ActiveShiftsMap />
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] pb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--paper)]">Moderator console</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/dashboard" className="btn-surgical min-h-[44px] inline-flex items-center px-3.5 py-2 text-xs font-semibold text-[var(--mint)] border-[var(--mint)]/40 hover:bg-[var(--mint)]/10">
            Logging dashboard →
          </Link>
          <Link href="/" className="min-h-[44px] inline-flex items-center text-xs text-[var(--fog)] underline hover:text-[var(--paper)]">
            employee view
          </Link>
          <ChangePassword />
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <ProvisionPanel />
        <SitePanel />
      </section>

      <AssignPanel
        employees={employees ?? []}
        sites={sites ?? []}
      />

      <ManagersPanel
        employees={(employees as any) ?? []}
        sites={sites ?? []}
      />

      <PayrollPanel employees={(employees ?? []) as never} role="moderator" />
      <ReviewPanel />
      <ShiftOverridePanel />
      <MessagesPanel role="moderator" />

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
          Employees
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Name</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Email</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Sites</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Locale</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Rate/h</th>
                <th scope="col" className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(employees ?? []).map((e: any) => (
                <tr key={e._id} className="border-t border-[var(--line)]/60 hover:bg-[var(--panel-elevated)]/40 transition">
                  <td className="p-3 font-medium text-[var(--paper)]">{e.name ?? "—"}</td>
                  <td className="p-3 text-[var(--fog)]">{e.email}</td>
                  <td className="p-3 text-[var(--text-secondary)]">
                    {(sites ?? [])
                      .filter((s: any) => e.assignedSiteIds?.includes(s._id))
                      .map((s: any) => s.name)
                      .join(", ") || "—"}
                  </td>
                  <td className={`p-3 font-semibold ${e.archivedAt ? "text-[var(--danger)]" : "text-[var(--mint)]"}`}>
                    {e.archivedAt ? "deactivated" : "active"}
                  </td>
                  <td className="p-3">
                    <LocaleCell userId={e._id} initial={e.locale ?? "en-ZA"} />
                  </td>
                  <td className="p-3">
                    <RateCell userId={e._id} initial={e.hourlyRateOverride} />
                  </td>
                  <td className="p-3 text-right">
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
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
          Audit log (7 days)
          {(review ?? []).length > 0 && (
            <span
              role="status"
              aria-live="polite"
              className="rounded-full bg-[var(--danger)]/20 px-2.5 py-0.5 text-xs font-semibold normal-case text-[var(--danger)]"
            >
              {review!.length} shift{review!.length === 1 ? "" : "s"} need review
            </span>
          )}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--panel-2)] text-[var(--fog)]">
              <tr>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Time (client)</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Employee</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Site</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Status</th>
                <th scope="col" className="p-3 text-right text-xs uppercase tracking-wider">±m</th>
                <th scope="col" className="p-3 text-right text-xs uppercase tracking-wider">Skew</th>
                <th scope="col" className="p-3 text-xs uppercase tracking-wider">Flags</th>
              </tr>
            </thead>
            <tbody>
              {(audit ?? []).map((l: any) => (
                <tr key={l._id} className="border-t border-[var(--line)]/60 hover:bg-[var(--panel-elevated)]/40 transition">
                  <td className="tnum p-3 font-medium text-[var(--paper)]">{formatDateTime(l.at, userLocale)}</td>
                  <td className="p-3 font-medium">{l.employeeName}</td>
                  <td className="p-3 text-[var(--fog)]">{l.siteName}</td>
                  <td className="p-3 text-[var(--text-secondary)]">{l.status}</td>
                  <td className="tnum p-3 text-right text-[var(--fog)]">{l.accuracyMeters}</td>
                  <td className={`tnum p-3 text-right ${(Math.abs(l.clockSkewMs) > 30000) ? "text-[var(--hivis)] font-semibold" : "text-[var(--fog)]"}`}>
                    {Math.round(l.clockSkewMs / 1000)}s
                  </td>
                  <td className="p-3">
                    {!l.isWithinGeofence && <span className="mr-1.5 font-semibold text-[var(--danger)]">geofence✗</span>}
                    {l.impossibleTravelFlag && <span className="font-semibold text-[var(--danger)]">travel!</span>}
                    {l.siteLat !== undefined && l.siteLng !== undefined && (
                      <button
                        onClick={() =>
                          setGeofenceFix({
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
                        className="btn-surgical ml-2 rounded px-3 py-1 text-xs font-semibold text-[var(--cyan)] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
                      >
                        map
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {geofenceFix && <GeofenceModal fix={geofenceFix} onClose={() => setGeofenceFix(null)} />}
    </main>
  );
}

function ProvisionPanel() {
  const provisionEmployeeAction = useAction(api.users.provisionEmployee);
  const provisionModeratorAction = useAction(api.users.provisionModerator);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "moderator">("employee");
  const [code, setCode] = useState<{ email: string; idCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="card-surgical p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Provision employee
      </h2>
      <div className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Role</span>
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
              setCode(await fn({ name, email }));
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
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create account + ID code ({role})</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {code && (
          <div className="card-subpanel border-[var(--mint)]/60 bg-[var(--mint)]/10 p-3.5 text-sm text-[var(--paper)]">
            <p className="mb-1 text-xs text-[var(--mint)] font-semibold uppercase tracking-wider">Give these to the employee NOW — shown once:</p>
            <p>Email: <strong>{code.email}</strong></p>
            <p>ID code: <strong className="tnum tracking-widest text-[var(--mint)] font-mono">{code.idCode}</strong></p>
            <button
              onClick={() => navigator.clipboard.writeText(`${code.email}: ${code.idCode}`)}
              className="btn-surgical mt-2.5 px-3 py-1 text-xs font-semibold text-[var(--mint)] border-[var(--mint)]/40 hover:bg-[var(--mint)]/10"
            >
              copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SitePanel() {
  const createSite = useMutation(api.sites.createSite);
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
    <div className="card-surgical p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">Create site</h2>
      <SiteMapPicker lat={latNum} lng={lngNum} onPick={(a, b) => setForm({ ...form, lat: String(a), lng: String(b) })} />
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Latitude</span>
          <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Latitude" inputMode="decimal"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Longitude</span>
          <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="Longitude" inputMode="decimal"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">Radius m</span>
          <input value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="Radius m"
            inputMode="numeric" className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:text-xs sm:font-medium sm:text-[var(--fog)]">IANA timezone</span>
          <input value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} placeholder="IANA timezone"
            className="input-surgical px-3.5 py-2 text-sm" />
        </label>
        <button
          data-loading={busy}
          aria-busy={busy}
          disabled={busy}
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
              });
              setMsg(`Created ${form.name}`);
              setForm({ ...form, name: "", lat: "", lng: "" });
            } catch (e) {
              setMsg(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
          className="btn-surgical col-span-2 min-h-[44px] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          <span className="btn-label">Create site</span>
          <span className="btn-spinner" aria-hidden="true" />
        </button>
        {msg && <p className="col-span-2 text-sm text-[var(--fog)]">{msg}</p>}
      </div>
    </div>
  );
}

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

  const openEditor = (m: { _id: string; managedSiteIds: string[] }) => {
    setOpenId(m._id);
    setChecked(new Set(m.managedSiteIds));
    setMsg(null);
  };

  return (
    <section className="card-surgical p-5">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Managers
      </h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Promote an employee to manager — same login, scoped to the sites you assign below.
        Managers see only their sites&apos; crew (map + roster). No payroll or provisioning rights.
      </p>

      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line)] pb-3">
        <select value={promoteUserId} onChange={(e) => setPromoteUserId(e.target.value)}
          className="input-surgical px-3.5 py-2 text-sm">
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
          className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Promote
        </button>
        {msg && <span className="text-sm font-medium text-[var(--paper)]">{msg}</span>}
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {(managers ?? []).map((m) => (
          <li key={m._id} className="rounded-lg border border-[var(--line)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-[var(--paper)]">{m.name ?? m.email}</span>
                {!m.isActive && <span className="ml-2 text-xs text-[var(--danger)]">deactivated</span>}
                <span className="ml-2 text-xs text-[var(--text-secondary)]">
                  {m.managedSiteNames.length > 0 ? m.managedSiteNames.join(", ") : "no sites scoped yet"}
                </span>
              </div>
              <span className="inline-flex gap-2">
                <button
                  onClick={() => (openId === m._id ? setOpenId(null) : openEditor(m))}
                  className="btn-surgical min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--cyan)] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
                >
                  {openId === m._id ? "Close" : "Assign sites"}
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
                  className="btn-surgical min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/10"
                >
                  Demote
                </button>
              </span>
            </div>
            {openId === m._id && (
              <div className="mt-3 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
                <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-lg border border-[var(--line)] p-2">
                  {sites.map((s) => {
                    const on = checked.has(s._id);
                    return (
                      <label key={s._id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
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
                        {s.name}
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2.5">
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
                    className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold"
                  >
                    Save sites
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {managers !== undefined && managers.length === 0 && (
          <li className="text-sm text-[var(--fog)]">No managers yet.</li>
        )}
      </ul>
    </section>
  );
}

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

  // Initialize the checklist from the employee's current assignments.
  const applySelection = (nextUserId: string) => {
    setUserId(nextUserId);
    setMsg(null);
    const emp = employees.find((e) => e._id === nextUserId);
    setChecked(new Set(emp?.assignedSiteIds ?? []));
  };

  return (
    <section className="card-surgical p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Assign employee ↔ sites
      </h2>
      <div className="flex flex-col gap-3">
        <select value={userId} onChange={(e) => applySelection(e.target.value)}
          className="input-surgical px-3.5 py-2 text-sm">
          <option value="">Employee…</option>
          {active.map((e: any) => (
            <option key={e._id} value={e._id}>{e.name ?? e.email}{e.role === "manager" ? " (manager)" : ""}</option>
          ))}
        </select>
        {userId && (
          <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-lg border border-[var(--line)] p-2">
            {sites.length === 0 && <p className="p-2 text-xs text-[var(--fog)]">No sites yet.</p>}
            {sites.map((s: any) => {
              const on = checked.has(s._id);
              return (
                <label key={s._id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-[var(--paper)] hover:bg-[var(--panel-elevated)]/50">
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
                  {s.name}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2.5">
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
          {msg && <span className="text-sm font-medium text-[var(--paper)]">{msg}</span>}
        </div>
      </div>
    </section>
  );
}

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

  const openEditor = (row: OverridableShift) => {
    setOpenId(row._id);
    setWhen(toLocalInput(row.endedAt ?? row.startedAt + 8 * 3600 * 1000));
    setReason("");
    setMsg(null);
  };

  return (
    <section className="card-surgical p-5">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fog)]">
        Shift override — forgotten log-off
      </h2>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Set a corrected end for a shift. The override feeds shift derivation (it survives later
        logs), requires a reason, and is blocked for sealed (payroll-finalized) shifts. Payroll
        reflects the change immediately.
      </p>
      {shifts !== undefined && shifts.length === 0 && (
        <p className="text-sm text-[var(--fog)]">No unsealed shifts in the last 14 days.</p>
      )}
      <ul className="flex max-h-96 flex-col divide-y divide-[var(--line)] overflow-y-auto">
        {(shifts ?? []).map((row) => (
          <li key={row._id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium text-[var(--paper)]">{row.employeeName}</span>
                <span className="ml-2 text-xs text-[var(--text-secondary)]">
                  {formatDateTime(row.startedAt, userLocale)} →{" "}
                  {row.endedAt ? formatDateTime(row.endedAt, userLocale) : "open"}
                </span>
                {row.needsReview && (
                  <span className="ml-2 rounded-full border border-[var(--amber,#fbbf24)]/40 px-1.5 py-0.5 text-xs text-[var(--amber,#fbbf24)]">
                    {row.hasOverride ? "overridden" : "needs review"}
                  </span>
                )}
                {!row.endedAt && (
                  <span className="ml-2 rounded-full border border-[var(--mint)]/40 px-1.5 py-0.5 text-xs text-[var(--mint)]">forgetting to log off?</span>
                )}
              </div>
              <button
                onClick={() => (openId === row._id ? setOpenId(null) : openEditor(row))}
                className="btn-surgical min-h-[44px] px-3 py-2 text-xs font-semibold text-[var(--cyan)] border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/10"
              >
                {openId === row._id ? "Close" : "Override end"}
              </button>
            </div>
            {openId === row._id && (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--line)] p-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                  Corrected end (local time)
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="input-surgical px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                  Reason (required, min 10 characters) — audited
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Employee called in — forgot to log off, left site at 17:30"
                    className="input-surgical px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex items-center gap-2.5">
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
                    className="btn-surgical btn-surgical-mint min-h-[44px] px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Save override"}
                  </button>
                  {msg && <span className="text-xs font-medium text-[var(--paper)]">{msg}</span>}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeactivateButton({ userId }: { userId: string }) {
  const deactivate = useMutation(api.users.deactivateEmployee);
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <span className="inline-flex gap-1">
      <button
        onClick={() => void deactivate({ userId: userId as Id<"users"> }).catch(() => {})}
        className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--danger)] border-[var(--danger)]/40"
      >
        confirm
      </button>
      <button onClick={() => setConfirming(false)} className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--fog)] hover:text-[var(--danger)]">
      deactivate
    </button>
  );
}

function LocaleCell({ userId, initial }: { userId: Id<"users">; initial: string }) {
  const setUserLocale = useMutation(api.users.setUserLocale);
  const LOCALES = ["en-ZA", "en-US", "en-GB", "en-AU", "es-ES", "fr-FR"] as const;
  return (
    <select
      defaultValue={initial}
      onChange={(e) =>
        void setUserLocale({ userId, locale: e.target.value as (typeof LOCALES)[number] }).catch(
          () => {}
        )
      }
      aria-label={`Locale for ${userId}`}
      className="input-surgical px-2.5 py-1.5 text-xs"
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
        className="input-surgical tnum w-20 px-2.5 py-1 text-right text-xs"
      />
      <button
        onClick={async () => {
          const n = value.trim() === "" ? undefined : Number(value);
          if (value.trim() !== "" && Number.isNaN(n)) return;
          await setRate({ userId, rate: n });
          setSaved(true);
        }}
        aria-label={saved ? `Rate saved for ${userId}` : `Set hourly rate for ${userId}`}
        className="btn-surgical rounded px-2.5 py-1 text-xs font-medium"
      >
        {saved ? "✓" : "set"}
      </button>
    </span>
  );
}

function ResetDeviceButton({ userId }: { userId: Id<"users"> }) {
  const reset = useMutation(api.users.resetDeviceToken);
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <span className="inline-flex gap-1">
      <button onClick={() => void reset({ userId }).catch(() => {})} className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--hivis)] border-[var(--hivis)]/40">
        confirm
      </button>
      <button onClick={() => setConfirming(false)} className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--fog)]">
        cancel
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="btn-surgical rounded px-2.5 py-1 text-xs text-[var(--fog)] hover:text-[var(--hivis)]">
      reset device
    </button>
  );
}
