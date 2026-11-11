"use client";

import { useCallback, useRef } from "react";
import { useMutation, useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { OutboxEntry } from "@/lib/outbox";
import { useOutbox } from "../use-outbox";
import { errMsg } from "@/lib/errors";
import { serverNow } from "@/lib/server-clock";
import { getPosition } from "./geoposition";
import { LABEL, TOKEN_KEY } from "./types";
import type { Status, Phase, CardSite } from "./types";

export function LiveSubmit({
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
        clientReportedTime: serverNow(),
        status,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: accuracy,
        sideMissionDurationMinutes:
          status === "quick side mission" ? (sideMinutes as 15 | 30 | 45 | 60 | 120) : undefined,
        deviceToken: token,
        idempotencyKey: crypto.randomUUID(),
        deviceMetadata: navigator.userAgent.slice(0, 200),
        queuedAt: serverNow(),
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