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
  /** Server-computed >200 km/h haversine speed verdict (§7). */
  impossibleTravelFlag?: boolean;
};

export type ShiftOverride = {
  endedAt: number;
  reason: string;
  overrideId: string;
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

export function deriveSegments(
  allLogs: EngineLog[],
  overrides?: ReadonlyMap<number, ShiftOverride>
): Segment[] {
  // Deduplicate deterministically. The previous version kept whichever row
  // arrived first in the caller's array, so the same set of logs could derive
  // different money depending on query order. Keep the earliest-persisted row
  // per idempotency key, and record any key whose retries disagree so the
  // resulting segment is reviewed instead of silently dropping a real punch.
  const kept = new Map<string, EngineLog>();
  const conflicts = new Set<string>();
  for (const log of allLogs) {
    const prior = kept.get(log.idempotencyKey);
    if (!prior) {
      kept.set(log.idempotencyKey, log);
      continue;
    }
    if (prior.status !== log.status || prior.clientReportedTime !== log.clientReportedTime || prior.sideMissionDurationMinutes !== log.sideMissionDurationMinutes) {
      conflicts.add(log.idempotencyKey);
    }
    const earlier =
      log._creationTime < prior._creationTime ||
      (log._creationTime === prior._creationTime &&
        log.clientReportedTime < prior.clientReportedTime);
    if (earlier) kept.set(log.idempotencyKey, log);
  }

  const ordered = [...kept.values()].sort((a, b) => {
    const byTime = skewCorrectedTime(a) - skewCorrectedTime(b);
    if (byTime !== 0) return byTime;
    const byCreation = a._creationTime - b._creationTime;
    if (byCreation !== 0) return byCreation;
    return a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0;
  });

  const segments: Segment[] = [];
  const deductions: number[] = [];
  const emit = (seg: Segment, deduction: number) => {
    segments.push(seg);
    deductions.push(deduction);
  };
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
    if (log.impossibleTravelFlag === true) out.push("impossible_travel");
    if (isOfflineReplay(log)) out.push("offline_replay");
    if (conflicts.has(log.idempotencyKey)) out.push("duplicate_key_conflict");
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
    const rawMinutes = Math.round((endedAt - current.startedAt) / 60000);
    if (rawMinutes - deductionMinutes < 0) {
      // Lunch/side-mission deduction exceeded the shift span: clamp at 0
      // but flag for review — silently paying 0 minutes hides bad data.
      review = true;
      reason = reason ?? "lunch_clamped";
    }
    current.totalMinutes = Math.max(0, rawMinutes - deductionMinutes);
    current.needsReview = review;
    current.reviewReason = reason;
    emit(current, deductionMinutes);
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
          emit({
            startedAt: t,
            endedAt: t,
            totalMinutes: 0,
            needsReview: true,
            reviewReason: "illegal_transition:none->checkpoint",
            timezone: log.siteTimezone,
          }, 0);
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
          if (phase === "none") {
            segFlags.add("illegal_transition:none->lunch");
          }
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
          segFlags.add("illegal_transition:none->quick side mission");
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
          emit({
            startedAt: t,
            endedAt: t,
            totalMinutes: 0,
            needsReview: true,
            reviewReason: "terminal_without_arrival",
            timezone: log.siteTimezone,
          }, 0);
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
          emit({
            startedAt: t,
            endedAt: t,
            totalMinutes: 0,
            needsReview: true,
            reviewReason: "terminal_without_arrival",
            timezone: log.siteTimezone,
          }, 0);
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
    const isAutoClosed = seg.startedAt + MAX_SHIFT_MS < now;
    const end = isAutoClosed ? seg.startedAt + MAX_SHIFT_MS : now;
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
    if (isAutoClosed) {
      seg.endedAt = end;
    } else {
      seg.endedAt = undefined;
    }
    // Open shifts accrue `now` as their end, so a declared-but-unecommenced
    // deduction clamping at 0 is normal, not corrupt — only closed segments
    // flag lunch_clamped (see closeCurrent).
    seg.totalMinutes = Math.max(0, Math.round((end - seg.startedAt) / 60000) - deductionMinutes);
    if (segFlags.size > 0 && !seg.needsReview) {
      seg.needsReview = true;
      seg.reviewReason = [...segFlags][0];
    }
    if (isAutoClosed && !seg.needsReview) {
      seg.needsReview = true;
      seg.reviewReason = seg.reviewReason ?? "auto_closed_no_terminal";
    }
    emit(seg, deductionMinutes);
  }

  // Moderator end-of-shift overrides: apply the latest override per segment
  // start. The override is derivation INPUT, so corrected ends survive every
  // re-derivation — an override is never silently reset by a later log.
  if (overrides !== undefined && overrides.size > 0) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const override = overrides.get(seg.startedAt);
      if (!override) continue;
      seg.endedAt = override.endedAt;
      seg.totalMinutes = Math.max(
        0,
        Math.round((override.endedAt - seg.startedAt) / 60000) - deductions[i]
      );
      seg.needsReview = false;
      seg.reviewReason = "moderator_override";
    }
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
