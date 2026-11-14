"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../convex/_generated/dataModel";
import { storageGet } from "@/lib/safe-storage";
import { useUserLocale } from "@/lib/use-user-locale";
import { formatTime, formatMinutesShort } from "@/lib/format";
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
import { deriveSegments } from "@/lib/shift-engine";
import { SiteSelector } from "./check-in/SiteSelector";
import { StatusChips } from "./check-in/StatusChips";
import { LiveSubmit } from "./check-in/live-submit";

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

export function CheckInCard() {
  const logsQuery = useQuery(api.logs.listMine);
  const sitesQuery = useQuery(api.sites.listMine);
  const userLocale = useUserLocale();

  const logs = useMemo(() => {
    const raw = (logsQuery ?? []) as unknown as CardLog[];
    return [...raw].sort(
      (a, b) =>
        (b.clientReportedTime ?? b._creationTime) - (a.clientReportedTime ?? a._creationTime) ||
        b._creationTime - a._creationTime
    );
  }, [logsQuery]);
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
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [userPickedSite, setUserPickedSite] = useState(false);
  const me = useQuery(api.users_queries.me);
  const recordFix = useMutation(api.travel.recordFix);
  const setConsent = useMutation(api.travel.setConsent);
  const lastFixSentRef = useRef(0);
  const serverModeRef = useRef<"on_site" | "traveling">("on_site");
  const consentAt = (me as { travelConsentAt?: number | null } | null | undefined)?.travelConsentAt ?? undefined;

  // Track whether the OS-level watch has errored (permission denied, etc.)
  const [locationError, setLocationError] = useState<string | null>(null);

  // Reset the pending action whenever the phase changes; collapse the site
  // picker once the worker is mid-shift.
  useEffect(() => {
    if (phase === "off") setPending("arrived");
    else if (phase === "on") setPending("day finish");
    else setPending("checkpoint");
    if (phase !== "off") setPickerOpen(false);
  }, [phase]);

  // Best-effort position fix for site distances (silent on failure).
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 }
    );
  }, []);

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
      setLocationError(null);
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
        deviceToken: storageGet(TOKEN_KEY) ?? "",
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
  }, [phase, consentAt, recordFix]);

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
  const isTrackingActive = phase === "on" && consentAt !== undefined;

  const submitStatus: Status = phase === "off" ? "arrived" : pending;

  // Re-anchor "today" at local midnight so todayLogs doesn't go stale overnight.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = setInterval(() => {
      setDayKey((prev) => {
        const next = new Date().toDateString();
        return next !== prev ? next : prev;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, []);
  const todayLogs = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return logs.filter((l) => (l.clientReportedTime ?? l._creationTime) >= start.getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, dayKey]);

  // Anchor for the shift clock: the latest OPEN segment from the same
  // segment machine payroll uses (deriveSegments) — not the last event,
  // which may be a checkpoint/lunch ping mid-shift. Falls back to the first
  // event of today when no open segment can be identified.
  const shiftAnchorMs = useMemo(() => {
    try {
      const segments = deriveSegments(
        logs.map((l) => ({
          _creationTime: l._creationTime,
          idempotencyKey: l._id,
          clientReportedTime: l.clientReportedTime ?? l._creationTime,
          status: l.status,
          isWithinGeofence: l.isWithinGeofence,
          impossibleTravelFlag: l.impossibleTravelFlag,
        }))
      );
      const open = [...segments].reverse().find((s) => s.endedAt === undefined);
      if (open) return open.startedAt;
    } catch {
      /* fall through to first-event-of-day anchor */
    }
    const firstToday = todayLogs[todayLogs.length - 1];
    return firstToday ? (firstToday.clientReportedTime ?? firstToday._creationTime) : undefined;
  }, [logs, todayLogs]);

  return (
    <section
      aria-label="Shift clock"
      data-testid="checkin-card"
      className="flex flex-col gap-3.5"
    >
      {/* ── Shift timer chassis (tabular-nums) ────────────────────── */}
      <ShiftTimer
        phase={phase}
        last={last}
        loaded={loaded}
        userLocale={userLocale}
        siteName={siteNameOf(last?.siteId)}
        shiftAnchorMs={shiftAnchorMs}
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

      {message && (
        <p
          className="text-center text-sm font-medium text-[var(--paper)]"
          data-testid="checkin-message"
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
