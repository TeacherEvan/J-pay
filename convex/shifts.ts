import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { deriveSegments, type EngineLog } from "../src/lib/shift-engine";
import type { Id } from "./_generated/dataModel";

const HORIZON_SAFETY_BUFFER_MS = 16 * 60 * 60 * 1000; // 16 hours

export const deriveForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // 1. Query existing shifts to find if any sealed shift exists
    const userShifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    const latestSealed = userShifts.find((s) => s.sealed === true);
    const horizonCutoff = latestSealed !== undefined
      ? latestSealed.startedAt - HORIZON_SAFETY_BUFFER_MS
      : undefined;

    // 2. Fetch logs within the active horizon (or all logs if no sealed shift)
    let logsQuery = ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId));

    if (horizonCutoff !== undefined) {
      logsQuery = logsQuery.filter((q) =>
        q.gte(q.field("clientReportedTime"), horizonCutoff)
      );
    }

    const all = await logsQuery.collect();

    const siteIds = [...new Set(all.map((l) => l.siteId))];
    const tzBySite = new Map<Id<"sites">, string>();
    for (const siteId of siteIds) {
      const site = await ctx.db.get(siteId);
      if (site?.timezone) tzBySite.set(siteId, site.timezone);
    }

    const resolutions = await ctx.db
      .query("reviewResolutions")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
    const resolvedKeys = new Set(resolutions.map((r) => r.shiftKey));

    const engineLogs: EngineLog[] = all.map((l) => ({
      _creationTime: l._creationTime,
      idempotencyKey: l.idempotencyKey,
      clientReportedTime: l.clientReportedTime,
      clockSkewMs: l.clockSkewMs,
      status: l.status as string,
      sideMissionDurationMinutes: l.sideMissionDurationMinutes,
      siteTimezone: tzBySite.get(l.siteId),
      isWithinGeofence: l.isWithinGeofence,
      impossibleTravelFlag: l.impossibleTravelFlag,
    }));

    const segments = deriveSegments(engineLogs);

    // 3. Clean up unsealed shifts within the active horizon
    // Sealed rows and rows strictly before horizonCutoff stay untouched.
    const sealedStarts = new Set(
      userShifts.filter((r) => r.sealed === true).map((r) => r.startedAt)
    );

    for (const row of userShifts) {
      // Sealed shifts are immutable
      if (row.sealed === true) continue;
      // If a horizonCutoff exists, shifts that started before the cutoff are preserved
      if (horizonCutoff !== undefined && row.startedAt < horizonCutoff) continue;
      await ctx.db.delete(row._id);
    }

    // 4. Insert newly derived segments that fall within the active horizon
    for (const seg of segments) {
      // Sealed rows stay frozen; skip reinsert to avoid duplicates.
      if (sealedStarts.has(seg.startedAt)) continue;
      // If cutoff exists and segment started before cutoff, skip it
      if (horizonCutoff !== undefined && seg.startedAt < horizonCutoff) continue;

      if (
        seg.needsReview &&
        resolvedKeys.has(String(seg.startedAt))
      ) {
        seg.needsReview = false;
        seg.reviewReason = `resolved:${seg.reviewReason ?? "flagged"}`;
      }
      const row: {
        userId: typeof args.userId;
        startedAt: number;
        endedAt?: number;
        totalMinutes?: number;
        needsReview: boolean;
        reviewReason?: string;
        timezone?: string;
        sealed?: boolean;
      } = {
        userId: args.userId,
        startedAt: seg.startedAt,
        needsReview: seg.needsReview,
      };
      if (seg.endedAt !== undefined) row.endedAt = seg.endedAt;
      if (seg.totalMinutes !== undefined) row.totalMinutes = seg.totalMinutes;
      if (seg.reviewReason !== undefined) row.reviewReason = seg.reviewReason;
      if (seg.timezone !== undefined) row.timezone = seg.timezone;
      await ctx.db.insert("shifts", row);
    }
  },
});
