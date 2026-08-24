import { query } from "./_generated/server";
import { v } from "convex/values";

export const auditRecentLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 7 * 24 * 3600 * 1000)
      )
      .order("desc")
      .take(args.limit ?? 100);
    const out = [];
    for (const log of logs) {
      const [user, site] = await Promise.all([ctx.db.get(log.userId), ctx.db.get(log.siteId)]);
      out.push({
        _id: log._id,
        status: log.status,
        at: log.clientReportedTime,
        serverAt: log._creationTime,
        clockSkewMs: log.clockSkewMs ?? 0,
        isWithinGeofence: log.isWithinGeofence,
        impossibleTravelFlag: log.impossibleTravelFlag === true,
        accuracyMeters: log.accuracyMeters,
        employeeName: user?.name ?? user?.email ?? "unknown",
        siteName: site?.name ?? "unknown",
      });
    }
    return out;
  },
});

export const auditNeedsReview = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .order("desc")
      .take(50);
  },
});

export const listEmployeesWithAssignments = query({
  args: {},
  handler: async (ctx) => {
    const employees = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .collect();
    const out = [];
    for (const e of employees) {
      const assignments = await ctx.db
        .query("userSites")
        .withIndex("by_user", (q) => q.eq("userId", e._id))
        .collect();
      out.push({
        _id: e._id,
        name: e.name,
        email: e.email,
        archivedAt: e.archivedAt,
        isActive: e.isActive,
        assignedSiteIds: assignments.map((a) => a.siteId),
      });
    }
    return out;
  },
});
