import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId } from "./access";
import { internal } from "./_generated/api";

export const auditRecentLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    const logs = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 7 * 24 * 3600 * 1000)
      )
      .order("desc")
      .take(args.limit ?? 100);
    const lookups = await Promise.all(
        logs.map((log) => Promise.all([ctx.db.get(log.userId), ctx.db.get(log.siteId)]))
    );
    const out = [];
    for (const [log, [user, site]] of zip(logs, lookups)) {
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
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    return await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .order("desc")
      .take(50);
  },
});

function zip<A, B>(a: A[], b: B[]): [A, B][] {
  return a.map((_, i) => [a[i], b[i]] as [A, B]);
}

export const listEmployeesWithAssignments = query({
  args: {},
  handler: async (ctx) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    const employees = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .collect();
    const allAssignments = await ctx.db.query("userSites").collect();
    const byUser = new Map<string, string[]>();
    for (const a of allAssignments) {
      (byUser.get(a.userId) ?? byUser.set(a.userId, []).get(a.userId)!).push(a.siteId);
    }
    const out = [];
    for (const e of employees) {
      const assignments = byUser.get(e._id) ?? [];
      out.push({
        _id: e._id,
        name: e.name,
        email: e.email,
        archivedAt: e.archivedAt,
        isActive: e.isActive,
        deviceId: e.deviceId,
        hourlyRateOverride: e.hourlyRateOverride,
        assignedSiteIds: assignments,
      });
    }
    return out;
  },
});

export const listAllSites = query({
  args: {},
  handler: async (ctx) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    return await ctx.db.query("sites").collect();
  },
});

export const resolveShift = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new ConvexError("SHIFT_NOT_FOUND");
    await ctx.db.patch(args.shiftId, {
      needsReview: false,
      reviewReason: `resolved:${shift.reviewReason ?? "flagged"}`,
    });
    await ctx.db.insert("reviewResolutions", {
      userId: shift.userId,
      shiftKey: String(shift.startedAt),
      resolvedAt: Date.now(),
      byModeratorId: await requireModerator(ctx),
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
      throw new ConvexError("RATE_OUT_OF_RANGE");
    }
    await ctx.db.patch(args.userId, { hourlyRateOverride: args.rate });
  },
});
