import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

const MAX_SHIFT_MS = 16 * 3600 * 1000;
const DEFAULT_LUNCH_MINUTES = 60;
const PICKER_MAX_MINUTES = 120;

type Segment = {
  startedAt: number;
  endedAt?: number;
  totalMinutes?: number;
  needsReview: boolean;
  reviewReason?: string;
};

function skewCorrectedTime(log: Doc<"logs">): number {
  const skew = log.clockSkewMs ?? 0;
  return Math.abs(skew) <= 30000 ? log.clientReportedTime : log._creationTime;
}

export const deriveForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .collect();
    const seenKeys = new Set<string>();
    const ordered = all
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
      const grossMs = endedAt - current.startedAt;
      current.endedAt = endedAt;
      current.totalMinutes = Math.max(0, Math.round(grossMs / 60000) - deductionMinutes);
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
      const status = log.status as string;

      if (current && t - current.startedAt > MAX_SHIFT_MS && status !== "day finish" && status !== "job finish") {
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
            const wall = sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
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
        case "quick side mission":
          if (phase === "none") {
            closeCurrent(t, true, "illegal_transition:none->side_mission");
          }
          if (phase === "sideMission") {
            closeCurrent(t, true, "illegal_transition:side_mission->side_mission");
          }
          if (!current) current = { startedAt: t, needsReview: false };
          phase = "sideMission";
          sideEntryAt = t;
          sideDeclared = log.sideMissionDurationMinutes ?? 0;
          break;
        case "feeling sick":
          if (phase === "sideMission") {
            const wall = sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
            deductionMinutes += Math.min(sideDeclared, wall);
            phase = "active";
          } else if (phase === "lunch" && lunchOpenedAt !== null) {
            deductionMinutes += DEFAULT_LUNCH_MINUTES;
            phase = "active";
          }
          if (!current) {
            current = { startedAt: t, needsReview: true, reviewReason: "terminal_without_arrival" };
            segments.push(current);
            current = null;
            phase = "none";
          } else {
            closeCurrent(t, false);
          }
          break;
        case "day finish":
        case "job finish":
          if (phase === "sideMission") {
            const wall = sideEntryAt !== null ? Math.round((t - sideEntryAt) / 60000) : sideDeclared;
            deductionMinutes += Math.min(sideDeclared, wall);
          } else if (phase === "lunch" && lunchOpenedAt !== null) {
            deductionMinutes += DEFAULT_LUNCH_MINUTES;
          }
          if (!current) {
            current = { startedAt: t, needsReview: true, reviewReason: "terminal_without_arrival" };
            segments.push(current);
            current = null;
          } else {
            closeCurrent(t, false);
          }
          break;
      }
    }

    if (current) {
      const now = Date.now();
      const end = Math.min(now, (current as Segment).startedAt + MAX_SHIFT_MS);
      if (phase === "sideMission") {
        deductionMinutes += sideDeclared;
        if (sideDeclared > 2 * PICKER_MAX_MINUTES) {
          (current as Segment).needsReview = true;
          (current as Segment).reviewReason = "unpaired_side_mission_excessive";
        }
      } else if (phase === "lunch") {
        deductionMinutes += DEFAULT_LUNCH_MINUTES;
      }
      (current as Segment).endedAt = end;
      (current as Segment).totalMinutes = Math.max(
        0,
        Math.round((end - (current as Segment).startedAt) / 60000) - deductionMinutes
      );
      if ((current as Segment).startedAt + MAX_SHIFT_MS < now && !(current as Segment).needsReview) {
        (current as Segment).needsReview = true;
        (current as Segment).reviewReason = (current as Segment).reviewReason ?? "auto_closed_no_terminal";
      }
      segments.push(current as Segment);
    }

    const old = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);

    for (const seg of segments) {
      const row: {
        userId: Id<"users">;
        startedAt: number;
        endedAt?: number;
        totalMinutes?: number;
        needsReview: boolean;
        reviewReason?: string;
      } = {
        userId: args.userId,
        startedAt: seg.startedAt,
        needsReview: seg.needsReview,
      };
      if (seg.endedAt !== undefined) row.endedAt = seg.endedAt;
      if (seg.totalMinutes !== undefined) row.totalMinutes = seg.totalMinutes;
      if (seg.reviewReason !== undefined) row.reviewReason = seg.reviewReason;
      await ctx.db.insert("shifts", row);
    }
  },
});
