export type EngineLog = {
  _creationTime: number;
  idempotencyKey: string;
  clientReportedTime: number;
  clockSkewMs?: number;
  status: string;
  sideMissionDurationMinutes?: number;
};

export type Segment = {
  startedAt: number;
  endedAt?: number;
  totalMinutes?: number;
  needsReview: boolean;
  reviewReason?: string;
};

export const MAX_SHIFT_MS = 16 * 3600 * 1000;
export const DEFAULT_LUNCH_MINUTES = 60;
export const PICKER_MAX_MINUTES = 120;

function skewCorrectedTime(log: EngineLog): number {
  const skew = log.clockSkewMs ?? 0;
  return Math.abs(skew) <= 30000 ? log.clientReportedTime : log._creationTime;
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

  const closeCurrent = (endedAt: number, review: boolean, reason?: string) => {
    if (!current) return;
    if (endedAt < current.startedAt && !review) {
      review = true;
      reason = "reversed_times";
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
  };

  for (const log of ordered) {
    const t = skewCorrectedTime(log);
    const status = log.status;

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
        current = { startedAt: t, needsReview: false };
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
          current = { startedAt: t, needsReview: false };
          phase = "lunch";
          lunchOpenedAt = t;
        } else if (phase === "active") {
          phase = "lunch";
          lunchOpenedAt = t;
        } else {
          closeCurrent(t, true, `illegal_transition:${phase}->lunch`);
          current = { startedAt: t, needsReview: false };
          phase = "lunch";
          lunchOpenedAt = t;
        }
        break;
      case "quick side mission": {
        if (current && phase === "sideMission") {
          closeCurrent(t, true, "illegal_transition:side_mission->side_mission");
        }
        if (!current) current = { startedAt: t, needsReview: false };
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
          if (t - lunchOpenedAt > 2 * DEFAULT_LUNCH_MINUTES * 60000) {
            excessiveLunch = true;
          }
        }
        if (!current) {
          segments.push({
            startedAt: t,
            needsReview: true,
            reviewReason: "terminal_without_arrival",
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
      if (sideDeclared > 2 * PICKER_MAX_MINUTES) {
        seg.needsReview = true;
        seg.reviewReason = "unpaired_side_mission_excessive";
      }
    } else if (phase === "lunch" && lunchOpenedAt !== null) {
      deductionMinutes += DEFAULT_LUNCH_MINUTES;
      if (now - lunchOpenedAt > 2 * DEFAULT_LUNCH_MINUTES * 60000) {
        seg.needsReview = true;
        seg.reviewReason = "unpaired_lunch_excessive";
      }
    }
    seg.endedAt = end;
    seg.totalMinutes = Math.max(0, Math.round((end - seg.startedAt) / 60000) - deductionMinutes);
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
