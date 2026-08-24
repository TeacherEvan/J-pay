"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessagesPanel } from "../messages";
import { PayrollPanel, ReviewPanel } from "../payroll";
import { ChangePassword, ForcedPasswordChange } from "../change-password";
import { SiteMapPicker } from "../site-map-picker";
import { errMsg } from "@/lib/errors";

export default function ModeratorPage() {
  const me = useQuery(api.users_queries.me);
  const employees = useQuery(api.moderator.listEmployeesWithAssignments);
  const sites = useQuery(api.moderator.listAllSites);
  const audit = useQuery(api.moderator.auditRecentLogs, { limit: 50 });
  const review = useQuery(api.moderator.auditNeedsReview);

  if (me === undefined) {
    return <main className="grid min-h-dvh place-items-center text-sm text-neutral-400">Loading…</main>;
  }
  if (me !== null && me !== undefined && me.passwordChangedAt === undefined) {
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
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Moderator console</h1>
        <Link href="/" className="text-xs text-neutral-400 underline">
          employee view
        </Link>
        <ChangePassword />
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <ProvisionPanel />
        <SitePanel />
      </section>

      <AssignPanel
        employees={employees ?? []}
        sites={sites ?? []}
      />

      <PayrollPanel employees={(employees ?? []) as never} />
      <ReviewPanel />
      <MessagesPanel role="moderator" />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Employees
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Sites</th>
                <th className="p-2">Status</th>
                <th className="p-2">Rate/h</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(employees ?? []).map((e) => (
                <tr key={e._id} className="border-t border-neutral-900">
                  <td className="p-2">{e.name ?? "—"}</td>
                  <td className="p-2 text-neutral-400">{e.email}</td>
                  <td className="p-2">
                    {(sites ?? [])
                      .filter((s) => e.assignedSiteIds?.includes(s._id))
                      .map((s) => s.name)
                      .join(", ") || "—"}
                  </td>
                  <td className={`p-2 ${e.archivedAt ? "text-red-400" : "text-emerald-400"}`}>
                    {e.archivedAt ? "deactivated" : "active"}
                  </td>
                  <td className="p-2">
                    <RateCell userId={e._id} initial={e.hourlyRateOverride} />
                  </td>
                  <td className="p-2 text-right">
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
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Audit log (7 days)
          {(review ?? []).length > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] normal-case text-red-300">
              {review!.length} shift(s) need review
            </span>
          )}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900 text-neutral-500">
              <tr>
                <th className="p-2">Time (client)</th>
                <th className="p-2">Employee</th>
                <th className="p-2">Site</th>
                <th className="p-2">Status</th>
                <th className="p-2">±m</th>
                <th className="p-2">Skew</th>
                <th className="p-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {(audit ?? []).map((l: { _id: Id<"logs">; at: number; employeeName: string; siteName: string; status: string; accuracyMeters: number; clockSkewMs: number; isWithinGeofence: boolean; impossibleTravelFlag: boolean }) => (
                <tr key={l._id} className="border-t border-neutral-900">
                  <td className="p-2">{new Date(l.at).toLocaleString()}</td>
                  <td className="p-2">{l.employeeName}</td>
                  <td className="p-2 text-neutral-400">{l.siteName}</td>
                  <td className="p-2">{l.status}</td>
                  <td className="p-2 text-neutral-400">{l.accuracyMeters}</td>
                  <td className={`p-2 ${(Math.abs(l.clockSkewMs) > 30000) ? "text-amber-400" : "text-neutral-500"}`}>
                    {Math.round(l.clockSkewMs / 1000)}s
                  </td>
                  <td className="p-2">
                    {!l.isWithinGeofence && <span className="mr-1 text-red-400">geofence✗</span>}
                    {l.impossibleTravelFlag && <span className="text-red-400">travel!</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Provision employee
      </h2>
      <div className="flex flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "moderator")}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <option value="employee">Employee</option>
          <option value="moderator">Moderator</option>
        </select>
        <button
          disabled={busy || !name || !email}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const fn = role === "employee" ? provisionEmployeeAction : provisionModeratorAction;
              setCode(await fn({ name, email }));
              setName("");
              setEmail("");
            } catch (e) {
              setError(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50"
        >
          Create account + ID code ({role})
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {code && (
          <div className="rounded-md border border-emerald-700 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            <p className="mb-1">Give these to the employee NOW — shown once:</p>
            <p>Email: <strong>{code.email}</strong></p>
            <p>ID code: <strong className="tracking-widest">{code.idCode}</strong></p>
            <button
              onClick={() => navigator.clipboard.writeText(`${code.email}: ${code.idCode}`)}
              className="mt-2 underline"
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Create site</h2>
      <SiteMapPicker lat={latNum} lng={lngNum} onPick={(a, b) => setForm({ ...form, lat: String(a), lng: String(b) })} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name"
          className="col-span-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Latitude" inputMode="decimal"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="Longitude" inputMode="decimal"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <input value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="Radius m"
          inputMode="numeric" className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <input value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} placeholder="IANA timezone"
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm" />
        <button
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
          className="col-span-2 rounded-md bg-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50"
        >
          Create site
        </button>
        {msg && <p className="col-span-2 text-xs text-neutral-400">{msg}</p>}
      </div>
    </div>
  );
}

function AssignPanel({
  employees,
  sites,
}: {
  employees: { _id: string; name?: string; email?: string; archivedAt?: number }[];
  sites: { _id: string; name: string }[];
}) {
  const assign = useMutation(api.sites.assignEmployee);
  const unassign = useMutation(api.sites.unassignEmployee);
  const [userId, setUserId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const active = employees.filter((e) => !e.archivedAt);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Assign employee ↔ site
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <option value="">Employee…</option>
          {active.map((e) => (
            <option key={e._id} value={e._id}>{e.name ?? e.email}</option>
          ))}
        </select>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
          <option value="">Site…</option>
          {sites.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
        <button
          disabled={!userId || !siteId}
          onClick={async () => {
            setMsg(null);
            try {
              await assign({ userId: userId as never, siteId: siteId as never });
              setMsg("Assigned.");
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50"
        >
          Assign
        </button>
        <button
          disabled={!userId || !siteId}
          onClick={async () => {
            setMsg(null);
            try {
              await unassign({ userId: userId as never, siteId: siteId as never });
              setMsg("Unassigned.");
            } catch (e) {
              setMsg(errMsg(e));
            }
          }}
          className="rounded-md border border-neutral-700 px-3 py-2 text-sm disabled:opacity-50"
        >
          Remove
        </button>
        {msg && <span className="text-xs text-neutral-400">{msg}</span>}
      </div>
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
        className="text-red-400 underline"
      >
        confirm
      </button>
      <button onClick={() => setConfirming(false)} className="text-neutral-500 underline">
        cancel
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="text-neutral-500 underline hover:text-red-400">
      deactivate
    </button>
  );
}

function RateCell({ userId, initial }: { userId: Id<"users">; initial?: number }) {
  const setRate = useMutation(api.moderator.setHourlyOverride);
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [saved, setSaved] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        inputMode="decimal"
        placeholder="default"
        className="w-16 rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-right"
      />
      <button
        onClick={async () => {
          const n = value.trim() === "" ? undefined : Number(value);
          if (value.trim() !== "" && Number.isNaN(n)) return;
          await setRate({ userId, rate: n });
          setSaved(true);
        }}
        className="rounded border border-neutral-700 px-1 py-0.5 text-[10px]"
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
      <button onClick={() => void reset({ userId }).catch(() => {})} className="text-amber-400 underline">
        confirm
      </button>
      <button onClick={() => setConfirming(false)} className="text-neutral-500 underline">
        cancel
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(true)} className="text-neutral-500 underline hover:text-amber-400">
      reset device
    </button>
  );
}
