import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireModerator, requireOrgScope, orgUsers } from "./access";

export const summary = query({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    // H1 fix (2026-08-26 review): this was a bare public query — any client
    // could read workforce counts without authentication. Row-scoped authz
    // per TRD R4/§7.
    await requireModerator(ctx);
    await requireOrgScope(ctx, args.orgId);

    const members = await orgUsers(ctx, args.orgId);
    const realEmployeeIds = new Set(members.map((e) => e._id as string));
    const isRealUser = (id: { toString(): string }) =>
      realEmployeeIds.has(id.toString());

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
      .filter((s) => !s.needsReview && isRealUser(s.userId))
      .reduce((a, s) => a + (s.totalMinutes ?? 0), 0);

    const flagged = (await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .collect())
      .filter((s) => isRealUser(s.userId));

    const recentLogs = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 24 * 3600 * 1000)
      )
      .take(1000);
    const anomalies24h = recentLogs.filter(
      (l) =>
        isRealUser(l.userId) &&
        (l.isWithinGeofence === false || l.impossibleTravelFlag === true)
    ).length;

    return {
      activeOnSite: active.filter((s) => isRealUser(s.userId)).length,
      weeklyBillableMinutes,
      pendingReviews: flagged.length,
      anomalies24h,
    };
  },
});
