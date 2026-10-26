import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { deriveSegments, type EngineLog } from "../src/lib/shift-engine";
import type { Id } from "./_generated/dataModel";

export const deriveForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .collect();

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

    const old = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .collect();
    const sealedStarts = new Set(
      old.filter((r) => r.sealed === true).map((r) => r.startedAt)
    );
    for (const row of old) {
      // Bounded rewrite: sealed history is never deleted or recomputed.
      if (row.sealed === true) continue;
      await ctx.db.delete(row._id);
    }

    for (const seg of segments) {
      // Sealed rows stay frozen; skip reinsert to avoid duplicates.
      if (sealedStarts.has(seg.startedAt)) continue;
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
