import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireModerator } from "./access";
import { internal } from "./_generated/api";

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
        deviceId: e.deviceId,
        hourlyRateOverride: e.hourlyRateOverride,
        assignedSiteIds: assignments.map((a) => a.siteId),
      });
    }
    return out;
  },
});

export const resolveShift = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("SHIFT_NOT_FOUND");
    await ctx.db.patch(args.shiftId, {
      needsReview: false,
      reviewReason: `resolved:${shift.reviewReason ?? "flagged"}`,
    });
  },
});

export const recomputeEmployeeShifts = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId: args.userId });
  },
});

export const setHourlyOverride = mutation({
  args: { userId: v.id("users"), rate: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    if (args.rate !== undefined && (args.rate < 0 || args.rate > 100000)) {
      throw new Error("RATE_OUT_OF_RANGE");
    }
    await ctx.db.patch(args.userId, { hourlyRateOverride: args.rate });
  },
});
