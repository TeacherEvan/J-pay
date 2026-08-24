import { query } from "./_generated/server";
import { v } from "convex/values";

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const modRows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "moderator"))
      .collect();
    const me = modRows.find((m) => m.isActive && m.archivedAt === undefined);
    if (!me) return null;

    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();

    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const weekShifts = await ctx.db
      .query("shifts")
      .withIndex("by_started", (q) => q.gte("startedAt", weekAgo))
      .collect();
    const weeklyBillableMinutes = weekShifts
      .filter((s) => !s.needsReview)
      .reduce((a, s) => a + (s.totalMinutes ?? 0), 0);

    const flagged = await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .collect();

    const recentLogs = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 24 * 3600 * 1000)
      )
      .take(1000);
    const anomalies24h = recentLogs.filter(
      (l) => l.isWithinGeofence === false || l.impossibleTravelFlag === true
    ).length;

    return {
      activeOnSite: active.length,
      weeklyBillableMinutes,
      pendingReviews: flagged.length,
      anomalies24h,
      demoModeEnabled: process.env.DEMO_MODE === "1",
    };
  },
});
