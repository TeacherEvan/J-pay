import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { deriveSegments, type EngineLog } from "../src/lib/shift-engine";

export const deriveForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .collect();

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
    }));

    const segments = deriveSegments(engineLogs);

    const old = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);

    for (const seg of segments) {
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

export type ShiftDocLike = Doc<"shifts">;
