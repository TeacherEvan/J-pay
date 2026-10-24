import { jpayConfig } from "../config/jpay.config";

export type EngineLog = {
  _creationTime: number;
  idempotencyKey: string;
  clientReportedTime: number;
  clockSkewMs?: number;
  status: string;
  sideMissionDurationMinutes?: number;
  siteTimezone?: string;
  /** Server-computed haversine verdict (§7). Outside-fence work needs review. */
  isWithinGeofence?: boolean;
};

export type Segment = {
  startedAt: number;
  endedAt?: number;
  totalMinutes?: number;
  needsReview: boolean;
  reviewReason?: string;
  timezone?: string;
};

const L = jpayConfig.laborRules;
export const MAX_SHIFT_MS = L.maxShiftHours * 3600 * 1000;
export const DEFAULT_LUNCH_MINUTES = L.defaultLunchMinutes;
export const PICKER_MAX_MINUTES = L.maxSideMissionMinutes;

/**
 * A log written more than this long after the client timestamp it carries is
 * an offline replay (queued on the device, synced later). Replays keep the
 * worker's real clock time but must be moderator-verified before they pay.
 */
export const REPLAY_REVIEW_MS = 5 * 60 * 1000;

function skewCorrectedTime(log: EngineLog): number {
  const skew = log.clockSkewMs ?? 0;
  return Math.abs(skew) <= L.skewToleranceMs ? log.clientReportedTime : log._creationTime;
}

/**
 * Clock skew must be measured when the entry is queued, not when it is
 * synced: an offline shift synced four hours later is not a four-hour clock
 * error, and measuring it at sync time makes the engine discard the worker's
 * real timestamps (§8.5). `queuedAt` is client-supplied, so a future value is
 * ignored and the server clock is used instead.
 */
export function serverClockSkewMs(
  clientReportedTime: number,
  queuedAt: number | undefined,
  now: number
): number {
  const anchor =
    queuedAt !== undefined && Number.isFinite(queuedAt) && queuedAt <= now ? queuedAt : now;
  return anchor - clientReportedTime;
}

export function isOfflineReplay(log: EngineLog): boolean {
  return log._creationTime - skewCorrectedTime(log) > REPLAY_REVIEW_MS;
}

export function deriveSegments(allLogs: EngineLog[]): Segment[] {
  const seenKeys = new Set<string>();
  const ordered = allLogs
    .filter((l) => {
      if (seenKeys.has(l.idempotencyKey)) return false;
      seenKeys.add(l.idempotencyKey);
      return true;
    })
    .sort((a, b) => skewCorrectedTime(a) - skewCorrectedTime(b));

  const segments: Segment[] = [];
  let current: Segment | null = null;
  let phase: "none" | "active" | "lunch" | "sideMission" = "none";
  let lunchOpenedAt: number | null = null;
  let sideEntryAt: number | null = null;
  let sideDeclared = 0;
  let deductionMinutes = 0;
  // Evidence flags that make a segment unpayable until a moderator resolves it.
  const segFlags = new Set<string>();
  const flagsOf = (log: EngineLog): string[] => {
    const out: string[] = [];
    if (log.isWithinGeofence === false) out.push("geofence_violation");
    if (isOfflineReplay(log)) out.push("offline_replay");
    return out;
  };

  const closeCurrent = (endedAt: number, review: boolean, reason?: string) => {
    if (!current) return;
    if (endedAt < current.startedAt && !review) {
      review = true;
      reason = "reversed_times";
    }
    if (segFlags.size > 0 && !review) {
      review = true;
      reason = [...segFlags][0];
    }
    current.endedAt = endedAt;
    current.totalMinutes = Math.max(
      0,
      Math.round((endedAt - current.startedAt) / 60000) - deductionMinutes
    );
    current.needsReview = review;
    current.reviewReason = reason;
    segments.push(current);
    current = null;
    phase = "none";
    lunchOpenedAt = null;
    sideEntryAt = null;
    sideDeclared = 0;
    deductionMinutes = 0;
    segFlags.clear();
  };

  for (const log of ordered) {
    const t = skewCorrectedTime(log);
    const status = log.status;
    const pendingFlags = flagsOf(log);
    if (current) for (const f of pendingFlags) segFlags.add(f);

    if (
      current &&
      t - current.startedAt > MAX_SHIFT_MS &&
      status !== "day finish" &&
      status !== "job finish"
    ) {
      closeCurrent(current.startedAt + MAX_SHIFT_MS, true, "auto_closed_no_terminal");
    }

    switch (status) {
      case "arrived":
        if (phase !== "none") {
          closeCurrent(t, true, `illegal_transition:${phase}->arrived`);
        }
        current = { startedAt: t, needsReview: false, timezone: log.siteTimezone };
        for (const f of pendingFlags) segFlags.add(f);
        phase = "active";
        break;
      case "checkpoint":
        if (phase === "sideMission") {
          const wall =
            sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
          deductionMinutes += Math.min(sideDeclared, wall);
          phase = "active";
        } else if (phase === "lunch") {
          phase = "active";
        } else if (phase === "none") {
          closeCurrent(t, true, "illegal_transition:none->checkpoint");
        }
        break;
      case "lunch":
        if (phase === "sideMission") {
          closeCurrent(t, true, "illegal_transition:side_mission->lunch");
          current = { startedAt: t, needsReview: false, timezone: log.siteTimezone };
          for (const f of pendingFlags) segFlags.add(f);
          phase = "lunch";
          lunchOpenedAt = t;
        } else if (phase === "active") {
          phase = "lunch";
          lunchOpenedAt = t;
        } else {
          closeCurrent(t, true, `illegal_transition:${phase}->lunch`);
          current = { startedAt: t, needsReview: false, timezone: log.siteTimezone };
          for (const f of pendingFlags) segFlags.add(f);
          phase = "lunch";
          lunchOpenedAt = t;
        }
        break;
      case "quick side mission": {
        if (current && phase === "sideMission") {
          closeCurrent(t, true, "illegal_transition:side_mission->side_mission");
        }
        if (!current) {
          current = { startedAt: t, needsReview: false, timezone: log.siteTimezone };
        }
        for (const f of pendingFlags) segFlags.add(f);
        phase = "sideMission";
        sideEntryAt = t;
        sideDeclared = log.sideMissionDurationMinutes ?? 0;
        break;
      }
      case "feeling sick":
        if (phase === "sideMission") {
          const wall =
            sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
          deductionMinutes += Math.min(sideDeclared, wall);
          phase = "active";
        } else if (phase === "lunch" && lunchOpenedAt !== null) {
          deductionMinutes += DEFAULT_LUNCH_MINUTES;
          phase = "active";
        }
        if (!current) {
          segments.push({
            startedAt: t,
            needsReview: true,
            reviewReason: "terminal_without_arrival",
            timezone: log.siteTimezone,
          });
        } else {
          closeCurrent(t, false);
        }
        break;
      case "day finish":
      case "job finish": {
        let excessiveLunch = false;
        if (phase === "sideMission") {
          const wall =
            sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
          deductionMinutes += Math.min(sideDeclared, wall);
        } else if (phase === "lunch" && lunchOpenedAt !== null) {
          deductionMinutes += DEFAULT_LUNCH_MINUTES;
          if (t - lunchOpenedAt > L.unpairedLunchThresholdMultiplier * DEFAULT_LUNCH_MINUTES * 60000) {
            excessiveLunch = true;
          }
        }
        if (!current) {
          segments.push({
            startedAt: t,
            needsReview: true,
            reviewReason: "terminal_without_arrival",
            timezone: log.siteTimezone,
          });
        } else {
          closeCurrent(
            t,
            excessiveLunch || current.needsReview,
            excessiveLunch ? "unpaired_lunch_excessive" : current.reviewReason
          );
        }
        break;
      }
    }
  }

  if (current) {
    const now = Date.now();
    const seg = current;
    const end = Math.min(now, seg.startedAt + MAX_SHIFT_MS);
    if (phase === "sideMission") {
      deductionMinutes += sideDeclared;
      if (sideDeclared > L.unpairedLunchThresholdMultiplier * PICKER_MAX_MINUTES) {
        seg.needsReview = true;
        seg.reviewReason = "unpaired_side_mission_excessive";
      }
    } else if (phase === "lunch" && lunchOpenedAt !== null) {
      deductionMinutes += DEFAULT_LUNCH_MINUTES;
      if (now - lunchOpenedAt > L.unpairedLunchThresholdMultiplier * DEFAULT_LUNCH_MINUTES * 60000) {
        seg.needsReview = true;
        seg.reviewReason = "unpaired_lunch_excessive";
      }
    }
    seg.endedAt = end;
    seg.totalMinutes = Math.max(0, Math.round((end - seg.startedAt) / 60000) - deductionMinutes);
    if (segFlags.size > 0 && !seg.needsReview) {
      seg.needsReview = true;
      seg.reviewReason = [...segFlags][0];
    }
    if (seg.startedAt + MAX_SHIFT_MS < now && !seg.needsReview) {
      seg.needsReview = true;
      seg.reviewReason = seg.reviewReason ?? "auto_closed_no_terminal";
    }
    segments.push(seg);
  }

  return segments;
}

export function localDayKey(epochMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}
