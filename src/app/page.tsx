"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { OutboxEntry } from "@/lib/outbox";
import { useOutbox } from "./use-outbox";
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

const TOKEN_KEY = "jpay.deviceToken";
const CONSENT_KEY = "jpay.consent";

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  });
}

function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) &&
    !(window.navigator as unknown as { standalone?: boolean }).standalone
  );
}

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users_queries.me) ?? null;
  const [consented, setConsented] = useState(true);
  const installEvent = useRef<{ prompt: () => Promise<void> } | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    setConsented(localStorage.getItem(CONSENT_KEY) === "1");
    const handler = (e: Event) => {
      e.preventDefault();
      installEvent.current = e as unknown as { prompt: () => Promise<void> };
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

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
    <>
      {!consented && (
        <ConsentGate
          onAccept={() => {
            localStorage.setItem(CONSENT_KEY, "1");
            setConsented(true);
          }}
        />
      )}
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">J-Pay</h1>
          <div className="flex items-center gap-2">
            {showInstall && (
              <button
                onClick={() => void installEvent.current?.prompt()}
                className="rounded-full border border-emerald-500 px-2 py-0.5 text-xs text-emerald-300"
              >
                Install app
              </button>
            )}
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs uppercase tracking-wide">
              {me.role}
            </span>
          </div>
        </header>
        {isIos() && (
          <p className="rounded-md bg-neutral-900 p-3 text-xs text-neutral-400">
            iPhone: add J-Pay to your Home Screen via Share → “Add to Home Screen”.
          </p>
        )}
        {me.role === "employee" ? (
          <EmployeePanel />
        ) : (
          <ModeratorLink />
        )}
        <footer id="privacy" className="mt-auto pt-8 text-xs leading-relaxed text-neutral-600">
          Location is recorded only when you press CHECK IN — never continuous tracking. Raw
          coordinates are anonymized after the payroll dispute window. No ads, no trackers.
        </footer>
      </main>
    </>
  );
}

function ConsentGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6">
      <div className="max-w-sm rounded-xl border border-neutral-800 bg-neutral-950 p-6">
        <h2 className="mb-3 text-lg font-semibold">All work, no ads!</h2>
        <p className="mb-3 text-sm leading-relaxed text-neutral-300">
          J-Pay records your GPS location and time only at your check-ins so your employer can run
          payroll accurately. Retention follows your local labor statute; raw coordinates are
          zeroed after the dispute window. Your data is never sold or used for advertising.
        </p>
        <button
          onClick={onAccept}
          className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950"
        >
          I understand
        </button>
      </div>
    </div>
  );
}

function ModeratorLink() {
  return (
    <a href="/moderator" className="text-emerald-400 underline">
      Open moderator console →
    </a>
  );
}

function EmployeePanel() {
  const createLog = useMutation(api.logs.createLog);
  const issueToken = useMutation(api.users.issueMyDeviceToken);
  const sites = useQuery(api.sites.listMine);
  const recentLogs = useQuery(api.logs.listMine);

  const deviceToken = useRef<string | null>(null);
  const tokenReady = useRef<Promise<string> | null>(null);

  const getToken = useCallback(async (): Promise<string> => {
    if (deviceToken.current) return deviceToken.current;
    if (tokenReady.current) return tokenReady.current;
    tokenReady.current = (async () => {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        deviceToken.current = stored;
        return stored;
      }
      const t = await issueToken();
      deviceToken.current = t;
      localStorage.setItem(TOKEN_KEY, t);
      return t;
    })();
    return tokenReady.current;
  }, [issueToken]);

  const flushOne = useCallback(
    async (entry: OutboxEntry) => {
      await createLog({
        siteId: entry.siteId as Id<"sites">,
        clientReportedTime: entry.clientReportedTime,
        status: entry.status as Status,
        latitude: entry.latitude,
        longitude: entry.longitude,
        accuracyMeters: entry.accuracyMeters,
        sideMissionDurationMinutes: entry.sideMissionDurationMinutes as
          | 15
          | 30
          | 45
          | 60
          | 120
          | undefined,
        deviceToken: entry.deviceToken,
        idempotencyKey: entry.idempotencyKey,
        deviceMetadata: entry.deviceMetadata,
      });
    },
    [createLog]
  );

  const { count, enqueue, flush, syncing, lastError } = useOutbox(flushOne);

  const [status, setStatus] = useState<Status>("arrived");
  const [siteId, setSiteId] = useState<Id<"sites"> | "">("");
  const [sideMinutes, setSideMinutes] = useState<number>(15);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function checkIn() {
    setMessage(null);
    let token: string;
    try {
      token = await getToken();
    } catch {
      setMessage("Device activation failed — reload the page.");
      return;
    }
    try {
      setBusy(true);
      const pos = await getPosition();
      const accuracy = Math.round(pos.coords.accuracy);
      if (accuracy > 50) {
        setMessage(`Weak GPS signal (±${accuracy}m). Move to open sky and retry.`);
        return;
      }
      const chosen: Id<"sites"> | "" = siteId || sites?.[0]?._id || "";
      if (!chosen) {
        setMessage("No site assigned — ask your moderator.");
        return;
      }
      const entry: OutboxEntry = {
        siteId: chosen,
        clientReportedTime: Date.now(),
        status,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: accuracy,
        sideMissionDurationMinutes:
          status === "quick side mission" ? (sideMinutes as 15 | 30 | 45 | 60 | 120) : undefined,
        deviceToken: token,
        idempotencyKey: crypto.randomUUID(),
        deviceMetadata: navigator.userAgent.slice(0, 200),
        queuedAt: Date.now(),
      };
      if (!navigator.onLine) {
        await enqueue(entry);
        setMessage(`Offline — check-in queued (${count + 1} pending).`);
        return;
      }
      try {
        const result = await createLog({
          siteId: entry.siteId as Id<"sites">,
          clientReportedTime: entry.clientReportedTime,
          status,
          latitude: entry.latitude,
          longitude: entry.longitude,
          accuracyMeters: entry.accuracyMeters,
          sideMissionDurationMinutes: entry.sideMissionDurationMinutes,
          deviceToken: token,
          idempotencyKey: entry.idempotencyKey,
          deviceMetadata: entry.deviceMetadata,
        });
        setMessage(result.duplicate ? "Duplicate ignored." : `Logged ${status}.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/fetch|network|TypeError|Failed/i.test(msg)) {
          await enqueue(entry);
          setMessage(`Connection lost — queued (${count + 1} pending).`);
        } else if (/DEVICE_TOKEN_INVALID/.test(msg)) {
          localStorage.removeItem(TOKEN_KEY);
          deviceToken.current = null;
          tokenReady.current = null;
          setMessage("Device was reset by moderator — tap CHECK IN again.");
        } else {
          setMessage(msg.replace(/^Uncaught Error: /, ""));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage(/denied|permission/i.test(msg) ? "Location permission denied." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {sites && sites.length === 0 && (
        <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-300">
          No site assigned yet. Your moderator must assign you before you can check in.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Site
        <select
          value={siteId}
          onChange={(e) => setSiteId(e.target.value as Id<"sites">)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        >
          {(sites ?? []).length === 0 && <option value="">No sites assigned</option>}
          {(sites ?? []).map((s) => (
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
      {lastError && <p className="text-center text-xs text-red-400">{lastError}</p>}
      {count > 0 && (
        <div className="flex items-center justify-between rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <span>{count} check-in{count === 1 ? "" : "s"} queued offline</span>
          <button onClick={() => void flush()} disabled={syncing} className="underline disabled:opacity-50">
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      )}
      {(recentLogs ?? []).length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent</h2>
          <ul className="flex flex-col gap-1">
            {recentLogs!.slice(0, 10).map((log) => (
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
