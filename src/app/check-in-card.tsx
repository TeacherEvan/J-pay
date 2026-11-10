"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { OutboxEntry } from "@/lib/outbox";
import { useOutbox } from "./use-outbox";
import { errMsg } from "@/lib/errors";
import { useUserLocale } from "@/lib/use-user-locale";
import { formatTime } from "@/lib/format";
import { haversineMeters } from "../../convex/geo";

import {
  STATUSES,
  LABEL,
  TERMINAL,
  WORKING,
  PAUSED,
  TOKEN_KEY,
  SIDE_MISSION_DURATIONS,
  phaseOf,
} from "./check-in/types";
import type { Status, Phase, CardLog, CardSite } from "./check-in/types";
import { StatusIcon } from "./check-in/StatusIcon";
import { ShiftTimer } from "./check-in/ShiftTimer"; // tabular-nums
import { SiteSelector } from "./check-in/SiteSelector";
import { StatusChips } from "./check-in/StatusChips";

export {
  STATUSES,
  LABEL,
  TERMINAL,
  WORKING,
  PAUSED,
  TOKEN_KEY,
  SIDE_MISSION_DURATIONS,
  phaseOf,
};
export type { Status, Phase, CardLog, CardSite };

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  });
}

export function formatMinutesShort(m: number): string {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min.toString().padStart(2, "0")}m` : `${min}m`;
}

export function CheckInCard({ variant }: { variant: "live" | "persona" }) {
  const isLive = variant === "live";
  const logsQuery = useQuery(isLive ? api.logs.listMine : api.demo.boundPersonaLogs);
  const sitesQuery = useQuery(isLive ? api.sites.listMine : api.demo.boundPersonaSites);
  const userLocale = useUserLocale();

  const logs = (logsQuery ?? []) as unknown as CardLog[];
  const sites = (sitesQuery ?? []) as unknown as CardSite[];
  const loaded = logsQuery !== undefined;

  const last = logs[0];
  const phase = phaseOf(last);

  const [pending, setPending] = useState<Status>("arrived");
  const [sideMinutes, setSideMinutes] = useState<number>(30);
  const [siteId, setSiteId] = useState<Id<"sites"> | "">("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [userPickedSite, setUserPickedSite] = useState(false);
  const me = useQuery(api.users_queries.me, isLive ? {} : "skip");
  const recordFix = useMutation(api.travel.recordFix);
  const setConsent = useMutation(api.travel.setConsent);
  const lastFixSentRef = useRef(0);
  const serverModeRef = useRef<"on_site" | "traveling">("on_site");
  const consentAt = (me as { travelConsentAt?: number | null } | null | undefined)?.travelConsentAt ?? undefined;

  // Track whether the OS-level watch has errored (permission denied, etc.)
  const [locationError, setLocationError] = useState<string | null>(null);

  // Live clock for the elapsed timer.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Reset the pending action whenever the phase changes; collapse the site
  // picker once the worker is mid-shift.
  useEffect(() => {
    if (phase === "off") setPending("arrived");
    else if (phase === "on") setPending("day finish");
    else setPending("checkpoint");
    if (phase !== "off") setPickerOpen(false);
  }, [phase]);

  // Best-effort position fix for site distances (live only, silent on failure).
  useEffect(() => {
    if (!isLive || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 }
    );
  }, [isLive]);

  const distances = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const s of sites) {
      map.set(s._id, fix ? haversineMeters(fix.lat, fix.lng, s.latitude, s.longitude) : null);
    }
    return map;
  }, [sites, fix]);

  // Auto-pick the nearest site once a fix arrives (until the user chooses).
  useEffect(() => {
    if (!fix || userPickedSite || sites.length === 0) return;
    let nearest: CardSite | null = null;
    let best = Infinity;
    for (const s of sites) {
      const d = haversineMeters(fix.lat, fix.lng, s.latitude, s.longitude);
      if (d < best) {
        best = d;
        nearest = s;
      }
    }
    if (nearest) setSiteId(nearest._id);
  }, [fix, sites, userPickedSite]);

  // On-shift, off-site-only, consent-gated live travel fixes. The server
  // decides what is stored (inside a geofence -> fix dropped); the client only
  // streams high-frequency fixes while off-site. Stops with the shift/consent.
  useEffect(() => {
    if (!isLive) return;
    // Track ONLY while the shift clock is running (arrived/checkpoint).
    // Lunch, quick side missions and sick leave (PAUSED) never stream fixes;
    // shift end (TERMINAL) never does either. Server enforces the same rule.
    if (phase !== "on" || consentAt === undefined || consentAt === null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const send = (position: GeolocationPosition) => {
      const now = Date.now();
      const minInterval = serverModeRef.current === "on_site" ? 60_000 : 15_000;
      if (now - lastFixSentRef.current < minInterval) return;
      const accuracy = position.coords.accuracy;
      if (!Number.isFinite(accuracy) || accuracy > 50) return; // server would reject anyway
      if (!Number.isFinite(position.timestamp)) return;
      lastFixSentRef.current = now;
      const clientReportedTime = Math.round(position.timestamp);
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${clientReportedTime}-${Math.random().toString(36).slice(2)}`;
      recordFix({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: accuracy,
        clientReportedTime,
        idempotencyKey,
        deviceToken: localStorage.getItem(TOKEN_KEY) ?? "",
      })
        .then((res: { status?: string; mode?: string } | undefined) => {
          if (res?.status === "recorded") {
            serverModeRef.current = res.mode === "on_site" || res.mode === "arrived" ? "on_site" : "traveling";
          }
        })
        .catch(() => {
          /* offline / transient — the next watch tick retries */
        });
    };

    const handleWatchError = (err: GeolocationPositionError) => {
      const msg =
        err.code === err.PERMISSION_DENIED
          ? "Location permission denied — tracking paused"
          : err.code === err.POSITION_UNAVAILABLE
            ? "Position unavailable — tracking paused"
            : "Location error — tracking paused";
      setLocationError(msg);
    };

    const id = navigator.geolocation.watchPosition(send, handleWatchError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 15_000,
    });
    return () => {
      navigator.geolocation.clearWatch(id);
    };
  }, [isLive, phase, consentAt, recordFix]);

  const chips: Status[] = useMemo(() => {
    if (phase === "on") return ["lunch", "quick side mission", "checkpoint", "feeling sick"];
    if (phase === "break")
      return ["checkpoint", "lunch", "quick side mission", "feeling sick", "day finish"];
    return [];
  }, [phase]);

  const siteNameOf = useCallback(
    (id?: Id<"sites">) => sites.find((s) => s._id === id)?.name,
    [sites]
  );

  const primaryLabel =
    phase === "off"
      ? "Start shift"
      : pending === "day finish"
        ? "Check out"
        : pending === "checkpoint" && phase === "break"
          ? "Back to work"
          : `Confirm ${LABEL[pending].toLowerCase()}`;

  // Travel tracking status for the employee (U2/U6): show whether fixes are
  // streaming, surface OS-level permission errors, and offer a revoke button.
  const isTrackingActive = isLive && phase === "on" && consentAt !== undefined;

  const submitStatus: Status = phase === "off" ? "arrived" : pending;

  const todayLogs = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return logs.filter((l) => (l.clientReportedTime ?? l._creationTime) >= start.getTime());
  }, [logs]);

  return (
    <section
      aria-label="Shift clock"
      data-testid={isLive ? "checkin-card" : "demo-checkin"}
      className="flex flex-col gap-3.5"
    >
      {/* ── Shift timer chassis (tabular-nums) ────────────────────── */}
      <ShiftTimer
        phase={phase}
        last={last}
        loaded={loaded}
        now={now}
        userLocale={userLocale}
        isLive={isLive}
        siteName={siteNameOf(last?.siteId)}
      />

      {/* Travel tracking status (U2/U6) — live indicator + one-tap revoke */}
      {isTrackingActive && (
        <div
          className="card-surgical flex items-center justify-between gap-2 p-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                locationError
                  ? "bg-[var(--danger)]"
                  : serverModeRef.current === "traveling"
                    ? "bg-[var(--mint)] animate-pulse"
                    : "bg-[var(--hivis)]/50"
              }`}
              aria-hidden="true"
            />
            <span className="font-medium text-[var(--paper)]">
              Travel tracking:{" "}
              {locationError
                ? <span className="text-[var(--danger)]">{locationError}</span>
                : serverModeRef.current === "traveling"
                  ? "ON — moving between sites"
                  : "ON — on site"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void setConsent({ consent: false }).catch(() => setMessage("Could not pause tracking — try again"))}
            className="btn-surgical rounded-lg border-[var(--danger)]/50 px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"
            aria-label="Pause travel tracking for this shift"
          >
            Pause tracking
          </button>
        </div>
      )}

      {/* ── Site picker (recessed bay) ────────────────────────────── */}
      <SiteSelector
        sites={sites}
        sitesLoading={sitesQuery === undefined}
        siteId={siteId}
        phase={phase}
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        onSelectSite={(id) => {
          setSiteId(id);
          setUserPickedSite(true);
        }}
        distances={distances}
        siteNameOf={siteNameOf}
        lastSiteId={last?.siteId}
      />

      {/* ── Quick actions (tactile rocker pills) ───────────────────── */}
      <StatusChips chips={chips} pending={pending} setPending={setPending} />

      {submitStatus === "quick side mission" && (
        <div className="card-subpanel flex items-center gap-3 p-3" role="group" aria-label="Side mission duration">
          <span className="text-sm font-medium text-[var(--fog)]">Declared duration</span>
          <div className="flex gap-1.5">
            {SIDE_MISSION_DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={sideMinutes === m}
                onClick={() => setSideMinutes(m)}
                className={`btn-surgical tnum min-h-[44px] min-w-[44px] rounded-lg px-2.5 py-2 text-sm ${
                  sideMinutes === m
                    ? "border-[var(--mint)]/70 bg-[var(--mint)]/15 text-[var(--paper)] font-semibold shadow-[0_0_8px_var(--mint-glow)]"
                    : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--fog)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLive ? (
        <LiveSubmit
          phase={phase}
          status={submitStatus}
          siteId={siteId}
          sitesLoading={sitesQuery === undefined}
          sites={sites}
          sideMinutes={sideMinutes}
          label={primaryLabel}
          busy={busy}
          setBusy={setBusy}
          setMessage={setMessage}
        />
      ) : (
        <PersonaSubmit
          status={submitStatus}
          siteId={siteId}
          sites={sites}
          sideMinutes={sideMinutes}
          label={primaryLabel}
          busy={busy}
          setBusy={setBusy}
          setMessage={setMessage}
        />
      )}

      {message && (
        <p
          className="text-center text-sm font-medium text-[var(--paper)]"
          data-testid={isLive ? "checkin-message" : "demo-checkin-message"}
          role="status"
        >
          {message}
        </p>
      )}

      {/* ── Today timeline ─────────────────────────────────────────── */}
      {todayLogs.length > 0 && (
        <section className="card-surgical mt-3 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
            Today&apos;s log
          </h2>
          <ol className="flex flex-col">
            {todayLogs.slice(0, 10).map((log, i) => {
              const verdict = log.isWithinGeofence
                ? log.impossibleTravelFlag
                  ? "travel"
                  : "inside"
                : "outside";
              const t = log.clientReportedTime ?? log._creationTime;
              return (
                <li
                  key={log._id}
                  data-testid="checkin-verdict"
                  data-verdict={verdict}
                  className={`flex items-center gap-3 py-2.5 ${i > 0 ? "border-t border-[var(--line)]/50" : ""}`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                      verdict === "inside"
                        ? "bg-[var(--mint)]/15 text-[var(--mint)]"
                        : "bg-[var(--danger)]/15 text-[var(--danger)]"
                    }`}
                  >
                    <StatusIcon status={log.status} />
                  </span>
                  <span className="text-sm font-medium">{LABEL[log.status as Status] ?? log.status}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {verdict === "outside" && (
                      <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-xs font-medium text-[var(--danger)]">
                        outside fence
                      </span>
                    )}
                    {verdict === "travel" && (
                      <span className="rounded-full bg-[var(--danger)]/15 px-2 py-0.5 text-xs font-medium text-[var(--danger)]">
                        travel flag
                      </span>
                    )}
                    <span className="tnum text-xs text-[var(--fog)]">
                      {formatTime(t, userLocale)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </section>
  );
}

/* ── Live submit: GPS + device token + offline outbox ──────────────── */
function LiveSubmit({
  phase,
  status,
  siteId,
  sitesLoading,
  sites,
  sideMinutes,
  label,
  busy,
  setBusy,
  setMessage,
}: {
  phase: Phase;
  status: Status;
  siteId: Id<"sites"> | "";
  sitesLoading: boolean;
  sites: CardSite[];
  sideMinutes: number;
  label: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessage: (m: string | null) => void;
}) {
  const createLog = useMutation(api.logs.createLog);
  const issueToken = useMutation(api.users.issueMyDeviceToken);
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
    })().catch((err) => {
      tokenReady.current = null;
      throw err;
    });
    return tokenReady.current;
  }, [issueToken]);

  const flushOne = useCallback(
    async (entry: OutboxEntry) => {
      const payload = {
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
        queuedAt: entry.queuedAt,
      };

      try {
        await createLog(payload);
      } catch (err: unknown) {
        const msg = String((err as { message?: string })?.message ?? err);
        if (msg.includes("DEVICE_TOKEN_INVALID")) {
          deviceToken.current = null;
          tokenReady.current = null;
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {}
          const fresh = await issueToken().catch(() => null);
          if (fresh) {
            deviceToken.current = fresh;
            try {
              localStorage.setItem(TOKEN_KEY, fresh);
            } catch {}
            payload.deviceToken = fresh;
            await createLog(payload);
            return;
          }
        }
        throw err;
      }
    },
    [createLog, issueToken]
  );

  const { count, enqueue, flush, syncing, lastError } = useOutbox(flushOne);

  const inflight = useRef(false);

  async function checkIn() {
    // U1 fix: synchronous in-flight guard + busy set before ANY await, so a
    // double-tap in the same frame cannot start two submissions.
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setMessage(null);
    let token: string;
    try {
      token = await getToken();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMessage(
        m.includes("DEVICE_ALREADY_ACTIVE")
          ? "Device already activated — ask your moderator to reset it."
          : "Device activation failed — reload the page."
      );
      return;
    }
    try {
      const pos = await getPosition();
      const accuracy = Math.round(pos.coords.accuracy);
      if (accuracy > 50) {
        setMessage(`Weak GPS signal (±${accuracy}m). Move to open sky and retry.`);
        return;
      }
      const chosen = siteId || sites[0]?._id || "";
      if (!chosen) {
        setMessage(
          sitesLoading
            ? "Loading your sites…"
            : "No site assigned — ask your moderator."
        );
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
        setMessage("Offline — check-in queued.");
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
          queuedAt: entry.queuedAt,
        });
        setMessage(
          result.duplicate
            ? "Already logged — duplicate ignored."
            : status === "arrived"
              ? "Shift started."
              : status === "day finish"
                ? "Checked out. Well done today."
                : `Logged: ${LABEL[status]}.`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/fetch|network|TypeError|Failed/i.test(msg)) {
          await enqueue(entry);
          setMessage("Connection lost — check-in queued.");
        } else if (/DEVICE_TOKEN_INVALID/.test(msg)) {
          localStorage.removeItem(TOKEN_KEY);
          deviceToken.current = null;
          tokenReady.current = null;
          setMessage("Device was reset by moderator — tap again.");
        } else {
          setMessage(errMsg(e));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage(/denied|permission/i.test(msg) ? "Location permission denied." : msg);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        data-testid="checkin-submit"
        data-loading={busy}
        aria-busy={busy}
        onClick={checkIn}
        disabled={busy}
        className={`btn-surgical h-16 rounded-xl text-lg font-bold transition disabled:opacity-50 ${
          status === "day finish"
            ? "btn-surgical-hivis"
            : "btn-surgical-mint"
        }`}
      >
        <span className="btn-label">{label}</span>
        <span className="btn-spinner" aria-hidden="true" />
      </button>
      {lastError && <p className="text-center text-sm text-[var(--danger)]">{lastError}</p>}
      {count > 0 && (
        <div className="card-subpanel flex items-center justify-between border-[var(--hivis)]/30 bg-[var(--hivis)]/10 px-4 py-2.5 text-sm text-[var(--hivis)]">
          <span className="tnum font-medium">
            {count} check-in{count === 1 ? "" : "s"} queued offline
          </span>
          <button
            data-testid="outbox-sync"
            data-loading={syncing}
            aria-busy={syncing}
            onClick={() => void flush()}
            disabled={syncing}
            className="btn-surgical min-h-[44px] px-3 py-1 text-xs border-[var(--hivis)]/40 text-[var(--hivis)] hover:text-[var(--hivis)] disabled:opacity-50"
          >
            <span className="btn-label">Sync now</span>
            <span className="btn-spinner" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}

/* ── Persona submit (demo): site coords, no GPS/token ──────────────── */
function PersonaSubmit({
  status,
  siteId,
  sites,
  sideMinutes,
  label,
  busy,
  setBusy,
  setMessage,
}: {
  status: Status;
  siteId: Id<"sites"> | "";
  sites: CardSite[];
  sideMinutes: number;
  label: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessage: (m: string | null) => void;
}) {
  const checkIn = useAction(api.demo.checkInAsPersona);
  const inflight = useRef(false);

  async function doCheckIn() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setMessage(null);
    const chosen = sites.find((s) => s._id === siteId) ?? sites[0];
    if (!chosen) {
      setMessage("No sites available for this persona.");
      inflight.current = false;
      setBusy(false);
      return;
    }
    try {
      const result = await checkIn({
        siteId: chosen._id,
        clientReportedTime: Date.now(),
        status,
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        accuracyMeters: 18,
        sideMissionDurationMinutes:
          status === "quick side mission" ? (sideMinutes as 15 | 30 | 45 | 60 | 120) : undefined,
        deviceToken: "demo-device-token",
        idempotencyKey: crypto.randomUUID(),
        deviceMetadata: "demo-reviewer-checkin",
      });
      setMessage(
        result.duplicate
          ? "Already logged — duplicate ignored."
          : `Logged: ${LABEL[status]} at ${chosen.name}.`
      );
    } catch (e) {
      setMessage(errMsg(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="demo-checkin-button"
      data-loading={busy}
      aria-busy={busy}
      onClick={() => void doCheckIn()}
      disabled={busy}
      className={`btn-surgical h-14 rounded-xl text-base font-bold transition disabled:opacity-50 ${
        status === "day finish"
          ? "btn-surgical-hivis"
          : "btn-surgical-mint"
      }`}
    >
      <span className="btn-label">{`${label} (as persona)`}</span>
      <span className="btn-spinner" aria-hidden="true" />
    </button>
  );
}
