import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireModerator } from "./access";
import { isDemoUser } from "./demo/scope";

export const summary = query({
  args: {},
  handler: async (ctx) => {
    // H1 fix (2026-08-26 review): this was a bare public query — any client
    // could read workforce counts without authentication. Row-scoped authz
    // per TRD R4/§7.
    await requireModerator(ctx);

    const modRows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "moderator"))
      .collect();
    const me = modRows.find((m) => m.isActive && m.archivedAt === undefined);
    if (!me) return null;

    const employees = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .collect();
    // Owner directive 2026-08-26: demo reviewers / seeded personas / e2e
    // users must not count toward real workforce KPIs.
    const realEmployeeIds = new Set(
      employees.filter((e) => !isDemoUser(e)).map((e) => e._id as string),
    );
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
      demoModeEnabled: process.env.DEMO_MODE === "1",
    };
  },
});
