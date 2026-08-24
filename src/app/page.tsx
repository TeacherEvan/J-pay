"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SignIn } from "./sign-in";

const STATUSES = [
  "arrived",
  "checkpoint",
  "lunch",
  "quick side mission",
  "feeling sick",
  "day finish",
  "job finish",
] as const;

type Status = (typeof STATUSES)[number];

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    });
  });
}

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users_queries.me) ?? null;
  const sites = useQuery(api.sites.listMine);
  const recentLogs = useQuery(api.logs.listMine);

  if (isLoading) {
    return <main className="grid min-h-dvh place-items-center text-sm text-neutral-400">Loading…</main>;
  }
  if (!isAuthenticated || !me) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <SignIn />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">J-Pay</h1>
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs uppercase tracking-wide">
          {me.role}
        </span>
      </header>
      {me.role === "employee" ? (
        <EmployeePanel
          sites={sites ?? []}
          recentLogs={recentLogs ?? []}
        />
      ) : (
        <ModeratorNotice />
      )}
    </main>
  );
}

function EmployeePanel({
  sites,
  recentLogs,
}: {
  sites: { _id: Id<"sites">; name: string }[];
  recentLogs: { _id: string; status: string; isWithinGeofence: boolean; impossibleTravelFlag?: boolean; _creationTime: number }[];
}) {
  const createLog = useMutation(api.logs.createLog);
  const issueToken = useMutation(api.users.issueMyDeviceToken);
  const [status, setStatus] = useState<Status>("arrived");
  const [siteId, setSiteId] = useState<Id<"sites"> | "">("");
  const [sideMinutes, setSideMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deviceToken = useRef<string | null>(null);

  useEffect(() => {
    if (!deviceToken.current) {
      issueToken()
        .then((t) => {
          deviceToken.current = t;
          try {
            localStorage.setItem("jpay.deviceToken", t);
          } catch {}
        })
        .catch(() => setMessage("Could not issue device token"));
    }
  }, [issueToken]);

  async function checkIn() {
    setMessage(null);
    let token = deviceToken.current;
    if (!token) {
      try {
        token = await issueToken();
        deviceToken.current = token;
      } catch {
        setMessage("Device token issuance failed");
        return;
      }
    }
    try {
      setBusy(true);
      const pos = await getPosition();
      const accuracy = pos.coords.accuracy;
      if (accuracy > 50) {
        setMessage(`Weak GPS signal (±${Math.round(accuracy)}m). Move to open sky and retry.`);
        return;
      }
      if (!siteId && sites.length > 0) setSiteId(sites[0]._id);
      const chosen: Id<"sites"> | "" = siteId || sites[0]?._id || "";
      if (!chosen) {
        setMessage("No site assigned — ask your moderator.");
        return;
      }
      const result = await createLog({
        siteId: chosen,
        clientReportedTime: Date.now(),
        status,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: Math.round(accuracy),
        sideMissionDurationMinutes:
          status === "quick side mission" ? (sideMinutes as 15 | 30 | 45 | 60 | 120) : undefined,
        deviceToken: token!,
        idempotencyKey: crypto.randomUUID(),
        deviceMetadata: navigator.userAgent.slice(0, 200),
      });
      setMessage(result.duplicate ? "Duplicate ignored." : `Logged ${status}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Site
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value as Id<"sites">)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        >
          {sites.length === 0 && <option value="">No sites assigned</option>}
          {sites.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              status === s
                ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                : "border-neutral-800 bg-neutral-900 text-neutral-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {status === "quick side mission" && (
        <label className="flex items-center gap-2 text-sm">
          Duration
          <select
            value={sideMinutes}
            onChange={(e) => setSideMinutes(Number(e.target.value))}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
          >
            {[15, 30, 45, 60, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        onClick={checkIn}
        disabled={busy}
        className="h-16 rounded-xl bg-emerald-500 text-lg font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? "Logging…" : "CHECK IN"}
      </button>
      {message && <p className="text-center text-sm text-neutral-300">{message}</p>}
      {recentLogs.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent</h2>
          <ul className="flex flex-col gap-1">
            {recentLogs.slice(0, 10).map((log) => (
              <li key={log._id} className="flex items-center justify-between rounded-md bg-neutral-900 px-3 py-1.5 text-xs">
                <span>{log.status}</span>
                <span className="text-neutral-500">
                  {new Date(log._creationTime).toLocaleTimeString()}
                  {!log.isWithinGeofence && " · outside geofence"}
                  {log.impossibleTravelFlag && " · travel flag"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModeratorNotice() {
  return (
    <p className="text-sm text-neutral-400">
      Moderator console (audit views, provisioning UI, CSV export) lands in the next iteration.
      Use the Convex dashboard functions for now.
    </p>
  );
}
