"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { OutboxEntry } from "@/lib/outbox";
import { useOutbox } from "./use-outbox";
import { errMsg } from "@/lib/errors";
import { useUserLocale } from "@/lib/use-user-locale";
import { formatCurrency, formatTime } from "@/lib/format";
import { haversineMeters } from "../../convex/geo";

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

const LABEL: Record<Status, string> = {
  arrived: "Arrived on site",
  checkpoint: "Checkpoint",
  lunch: "Lunch break",
  "quick side mission": "Side mission",
  "feeling sick": "Feeling sick",
  "day finish": "Day finish",
  "job finish": "Job finish",
};

const TERMINAL: readonly Status[] = ["day finish", "job finish"];
const WORKING: readonly Status[] = ["arrived", "checkpoint"];
const PAUSED: readonly Status[] = ["lunch", "quick side mission", "feeling sick"];

type Phase = "off" | "on" | "break";

const TOKEN_KEY = "jpay.deviceToken";
const SIDE_MISSION_DURATIONS = [15, 30, 45, 60, 120] as const;

function phaseOf(last?: { status: string }): Phase {
  if (!last) return "off";
  const s = last.status as Status;
  if (TERMINAL.includes(s)) return "off";
  if (WORKING.includes(s)) return "on";
  if (PAUSED.includes(s)) return "break";
  return "off";
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 0,
    });
  });
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

export function formatMinutesShort(m: number): string {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min.toString().padStart(2, "0")}m` : `${min}m`;
}

function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function StatusIcon({ status }: { status: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (status as Status) {
    case "arrived":
      return (
        <svg {...common}>
          <path d="M9.5 2.5h4v11h-4" />
          <path d="M2 8h7.5M6.5 5l3 3-3 3" />
        </svg>
      );
    case "checkpoint":
      return (
        <svg {...common}>
          <path d="M4 14V2.5" />
          <path d="M4 3h7l-1.5 2.5L11 8H4" />
        </svg>
      );
    case "lunch":
      return (
        <svg {...common}>
          <path d="M3 6h8v3.5a4 4 0 0 1-8 0V6Z" />
          <path d="M11 6.5h1.25a1.75 1.75 0 0 1 0 3.5H11" />
          <path d="M2.5 14h9" />
        </svg>
      );
    case "quick side mission":
      return (
        <svg {...common}>
          <path d="M2.5 12.5 6 9l2.5 2.5L13.5 6" />
          <path d="M10 6h3.5v3.5" />
        </svg>
      );
    case "feeling sick":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M5.5 8h5M8 5.5v5" />
        </svg>
      );
    case "day finish":
      return (
        <svg {...common}>
          <path d="M12.5 9.75A5.25 5.25 0 0 1 6.25 3.5a5.25 5.25 0 1 0 6.25 6.25Z" />
        </svg>
      );
    case "job finish":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
          <path d="m5.5 8 1.75 1.75L10.5 6.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.75" />
        </svg>
      );
  }
}

type CardLog = {
  _id: string;
  status: string;
  isWithinGeofence: boolean;
  impossibleTravelFlag?: boolean;
  siteId?: Id<"sites">;
  clientReportedTime?: number;
  _creationTime: number;
};

type CardSite = {
  _id: Id<"sites">;
  name: string;
  latitude: number;
  longitude: number;
};

/** Today's cleared minutes + pay, for the shift-card corner (live only). */
function TodayStrip() {
  const me = useQuery(api.users_queries.me);
  const range = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { fromMs: d.getTime(), toMs: d.getTime() + 36 * 3600 * 1000 };
  }, []);
  const pay = useQuery(
    api.payroll.calcForEmployee,
    me ? { userId: me._id, fromMs: range.fromMs, toMs: range.toMs } : "skip"
  );
  if (!pay || pay.totals.payableMinutes === 0) return null;
  return (
    <p className="tnum text-xs text-[var(--fog)]">
      Today {formatMinutesShort(pay.totals.payableMinutes)} ·{" "}
      <span className="text-[var(--paper)]">
        {formatCurrency(pay.totals.pay, pay.currency, pay.locale)}
      </span>
    </p>
  );
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
  const siteRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  const timerAnchor = last ? (last.clientReportedTime ?? last._creationTime) : null;
  const elapsed = phase !== "off" && timerAnchor ? now - timerAnchor : null;

  const primaryLabel =
    phase === "off"
      ? "Start shift"
      : pending === "day finish"
        ? "Check out"
        : pending === "checkpoint" && phase === "break"
          ? "Back to work"
          : `Confirm ${LABEL[pending].toLowerCase()}`;

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
      className="flex flex-col gap-3"
    >
      {/* ── Shift card: the state lamp ─────────────────────────────── */}
      <div
        className={`rounded-2xl border p-5 ${
          phase === "on"
            ? "border-[var(--hivis)]/60 bg-[var(--hivis)]/[0.07]"
            : phase === "break"
              ? "border-[var(--hivis)]/35 bg-[var(--hivis)]/[0.04]"
              : "border-[var(--line)] bg-[var(--panel)]"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${
              phase === "off" ? "text-[var(--fog)]" : "text-[var(--hivis)]"
            }`}
          >
            <span
              className={`pulse-dot inline-block h-2 w-2 rounded-full ${
                phase === "on"
                  ? "bg-[var(--hivis)]"
                  : phase === "break"
                    ? "bg-[var(--hivis)]/60"
                    : "bg-[var(--fog)]"
              }`}
            />
            {phase === "on"
              ? "On the clock"
              : phase === "break"
                ? `On break · ${last ? LABEL[last.status as Status] : ""}`
                : "Off the clock"}
          </p>
          {isLive && <TodayStrip />}
        </div>

        <p className="tnum mt-2 text-5xl font-semibold tracking-tight" aria-live="off">
          {!loaded ? "··:··:··" : elapsed !== null ? formatElapsed(elapsed) : "—:—:—"}
        </p>

        <p className="mt-1 text-sm text-[var(--fog)]">
          {!loaded
            ? "Reading your latest event…"
            : phase === "off"
              ? last
                ? `Last event: ${LABEL[last.status as Status]} at ${
                    timerAnchor ? formatTime(timerAnchor, userLocale) : "—"
                  }`
                : "Your shift hasn't started yet."
              : `${
                  siteNameOf(last?.siteId) ? `At ${siteNameOf(last?.siteId)}` : "On shift"
                } since ${timerAnchor ? formatTime(timerAnchor, userLocale) : "—"}`}
        </p>
      </div>

      {/* ── Site picker ────────────────────────────────────────────── */}
      {sites.length > 0 && (phase === "off" || pickerOpen) && (
        <div
          role="radiogroup"
          aria-label="Site"
          className="flex flex-col gap-1.5"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const cur = sites.findIndex((s) => s._id === siteId);
            const next =
              e.key === "ArrowDown"
                ? (cur + 1) % sites.length
                : (cur - 1 + sites.length) % sites.length;
            setSiteId(sites[next]!._id);
            setUserPickedSite(true);
            siteRefs.current[next]?.focus();
          }}
        >
          {sites.map((s, i) => {
            const selected = siteId ? siteId === s._id : i === 0;
            const dist = distances.get(s._id) ?? null;
            return (
              <button
                key={s._id}
                ref={(el) => {
                  siteRefs.current[i] = el;
                }}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setSiteId(s._id);
                  setUserPickedSite(true);
                }}
                className={`flex min-h-[44px] items-center justify-between rounded-xl border px-4 py-2.5 text-left text-sm ${
                  selected
                    ? "border-[var(--mint)]/70 bg-[var(--mint)]/10 text-[var(--paper)]"
                    : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--fog)]"
                }`}
              >
                <span className="font-medium">{s.name}</span>
                {dist !== null && (
                  <span className="tnum text-xs text-[var(--fog)]">{formatDistance(dist)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {sites.length > 0 && phase !== "off" && (
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="self-start text-xs text-[var(--fog)] underline hover:text-[var(--paper)]"
        >
          {pickerOpen ? "Hide sites" : `Site: ${siteNameOf(siteId || last?.siteId) ?? "choose"}`}
        </button>
      )}
      {sites.length === 0 && sitesQuery !== undefined && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          No site assigned yet — your moderator must assign you before you can check in.
        </p>
      )}

      {/* ── Quick actions ──────────────────────────────────────────── */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="What's happening">
          {chips.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={pending === s}
              onClick={() => setPending(s)}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-sm ${
                pending === s
                  ? "border-[var(--hivis)]/70 bg-[var(--hivis)]/10 text-[var(--hivis)]"
                  : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--fog)]"
              }`}
            >
              <StatusIcon status={s} />
              {LABEL[s]}
            </button>
          ))}
        </div>
      )}

      {submitStatus === "quick side mission" && (
        <div className="flex items-center gap-2" role="group" aria-label="Side mission duration">
          <span className="text-sm text-[var(--fog)]">Declared duration</span>
          <div className="flex gap-1">
            {SIDE_MISSION_DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={sideMinutes === m}
                onClick={() => setSideMinutes(m)}
                className={`tnum min-h-[44px] min-w-[44px] rounded-lg border px-2 py-2 text-sm ${
                  sideMinutes === m
                    ? "border-[var(--mint)]/70 bg-[var(--mint)]/10 text-[var(--paper)]"
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
          className="text-center text-sm text-[var(--paper)]"
          data-testid={isLive ? "checkin-message" : "demo-checkin-message"}
          role="status"
        >
          {message}
        </p>
      )}

      {/* ── Today timeline ─────────────────────────────────────────── */}
      {todayLogs.length > 0 && (
        <section className="mt-3">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fog)]">
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
                  className={`flex items-center gap-3 py-2 ${i > 0 ? "border-t border-[var(--line)]/50" : ""}`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                      verdict === "inside"
                        ? "bg-[var(--mint)]/15 text-[var(--mint)]"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    <StatusIcon status={log.status} />
                  </span>
                  <span className="text-sm">{LABEL[log.status as Status] ?? log.status}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {verdict === "outside" && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">
                        outside fence
                      </span>
                    )}
                    {verdict === "travel" && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">
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

  async function checkIn() {
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
      setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <>
      <button
        data-testid="checkin-submit"
        onClick={checkIn}
        disabled={busy}
        className={`h-16 rounded-xl text-lg font-bold transition disabled:opacity-50 ${
          status === "day finish"
            ? "bg-[var(--hivis)] text-black hover:brightness-110"
            : "bg-[var(--mint)] text-emerald-950 hover:brightness-110"
        }`}
      >
        {busy ? "Logging…" : label}
      </button>
      {lastError && <p className="text-center text-sm text-red-400">{lastError}</p>}
      {count > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
          <span className="tnum">
            {count} check-in{count === 1 ? "" : "s"} queued offline
          </span>
          <button
            data-testid="outbox-sync"
            onClick={() => void flush()}
            disabled={syncing}
            className="min-h-[44px] underline disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync now"}
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

  async function doCheckIn() {
    setMessage(null);
    const chosen = sites.find((s) => s._id === siteId) ?? sites[0];
    if (!chosen) {
      setMessage("No sites available for this persona.");
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="demo-checkin-button"
      onClick={() => void doCheckIn()}
      disabled={busy}
      className={`h-14 rounded-xl text-base font-bold transition disabled:opacity-50 ${
        status === "day finish"
          ? "bg-[var(--hivis)] text-black hover:brightness-110"
          : "bg-[var(--mint)] text-emerald-950 hover:brightness-110"
      }`}
    >
      {busy ? "Logging…" : `${label} (as persona)`}
    </button>
  );
}
