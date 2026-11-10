import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId } from "./access";
import { internal } from "./_generated/api";
import { isDemoUser, isDemoLog } from "./demo/scope";
import type { Id } from "./_generated/dataModel";

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
    // Owner directive 2026-08-26: real moderator logins must never surface
    // demo/seeded rows. Filter them out before the N+1 user/site lookups so
    // the take() limit applies to real rows only.
    const realLogs = logs.filter((l) => !isDemoLog(l));
    const lookups = await Promise.all(
        realLogs.map((log) => Promise.all([ctx.db.get(log.userId), ctx.db.get(log.siteId)]))
    );
    const out = [];
    for (const [log, [user, site]] of zip(realLogs, lookups)) {
      if (user && isDemoUser(user)) continue;
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
        lat: log.latitude,
        lng: log.longitude,
        siteLat: site?.latitude,
        siteLng: site?.longitude,
        siteRadius: site?.geofenceRadiusMeters,
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
    const flagged = await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .order("desc")
      .take(50);
    const out = [];
    for (const s of flagged) {
      const u = await ctx.db.get(s.userId);
      if (u && isDemoUser(u)) continue;
      out.push(s);
    }
    return out;
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
    const managers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "manager"))
      .collect();
    employees.push(...managers);
    const allAssignments = await ctx.db.query("userSites").collect();
    const byUser = new Map<string, Id<"sites">[]>();
    for (const a of allAssignments) {
      (byUser.get(a.userId) ?? byUser.set(a.userId, []).get(a.userId)!).push(a.siteId);
    }
    const out = [];
    for (const e of employees) {
      // Owner directive 2026-08-26: demo reviewers, seeded personas, and
      // e2e-provisioned users never appear in a real moderator's roster.
      if (isDemoUser(e)) continue;
      const assignments = byUser.get(e._id) ?? [];
      const siteNames: string[] = [];
      for (const siteId of assignments) {
        const site = await ctx.db.get(siteId);
        if (site && "name" in site) siteNames.push(site.name);
      }
      out.push({
        _id: e._id,
        role: e.role,
        name: e.name,
        email: e.email,
        archivedAt: e.archivedAt,
        isActive: e.isActive,
        deviceId: e.deviceId,
        hourlyRateOverride: e.hourlyRateOverride,
        locale: e.locale,
        assignedSiteIds: assignments,
        siteNames,
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
    const sites = await ctx.db.query("sites").collect();
    const out = [];
    for (const s of sites) {
      const creator = await ctx.db.get(s.createdBy);
      if (creator && isDemoUser(creator)) continue;
      out.push(s);
    }
    return out;
  },
});

export const resolveShift = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    // Must THROW for a non-moderator: returning [] made the UI show a silent
    // success and left the flagged shift unresolved.
    const modId = await requireModerator(ctx);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new ConvexError("SHIFT_NOT_FOUND");
    await ctx.db.patch(args.shiftId, {
      needsReview: false,
      reviewReason: `resolved:${shift.reviewReason ?? "flagged"}`,
      sealed: true,
    });
    await ctx.db.insert("reviewResolutions", {
      userId: shift.userId,
      shiftKey: String(shift.startedAt),
      resolvedAt: Date.now(),
      byModeratorId: modId,
    });
    return { ok: true as const };
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

/**
 * Open or recently-closed, non-sealed shifts a moderator may correct the end
 * of. Demo personas and sealed (payroll-finalized) rows are excluded — the
 * override mutation refuses them too.
 */
export const overridableShifts = query({
  args: {},
  handler: async (ctx) => {
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_started", (q) => q.gte("startedAt", cutoff))
      .order("desc")
      .take(60);
    const out = [];
    for (const shift of rows) {
      if (shift.sealed === true) continue;
      const user = await ctx.db.get(shift.userId);
      if (!user || isDemoUser(user)) continue;
      if (!user.isActive || user.archivedAt !== undefined) continue;
      out.push({
        _id: shift._id,
        userId: shift.userId,
        employeeName: user.name ?? user.email ?? "unknown",
        startedAt: shift.startedAt,
        endedAt: shift.endedAt,
        totalMinutes: shift.totalMinutes,
        needsReview: shift.needsReview,
        reviewReason: shift.reviewReason,
        hasOverride: shift.reviewReason === "moderator_override",
      });
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  },
});

/**
 * Moderator sets a corrected end for a shift — the forgotten-to-log-off fix.
 * The override is recorded as derivation INPUT (shiftOverrides feeds the next
 * deriveForUser), so it survives re-derivation. Sealed shifts refuse.
 */
export const endShiftOverride = mutation({
  args: {
    shiftId: v.id("shifts"),
    endedAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const modId = await requireModerator(ctx);
    const reason = args.reason.trim();
    if (reason.length < 10) throw new ConvexError("REASON_TOO_SHORT");
    if (!Number.isFinite(args.endedAt)) throw new ConvexError("INVALID_TIME");
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new ConvexError("SHIFT_NOT_FOUND");
    if (shift.sealed === true) throw new ConvexError("PAYROLL_SEALED");
    const target = await ctx.db.get(shift.userId);
    if (!target || isDemoUser(target)) throw new ConvexError("FORBIDDEN");
    if (args.endedAt < shift.startedAt) throw new ConvexError("ENDED_BEFORE_START");
    if (args.endedAt > Date.now() + 5 * 60 * 1000) throw new ConvexError("ENDED_IN_FUTURE");
    await ctx.db.insert("shiftOverrides", {
      userId: shift.userId,
      shiftKey: String(shift.startedAt),
      endedAt: args.endedAt,
      reason,
      byModeratorId: modId,
      previousEndedAt: shift.endedAt,
      previousTotalMinutes: shift.totalMinutes,
    });
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId: shift.userId });
    return { ok: true as const, previousEndedAt: shift.endedAt ?? null };
  },
});

export const activeShifts = query({
  args: {},
  handler: async (ctx) => {
    // Sibling of auditRecentLogs: moderator-gated, demo-filtered, returns []
    // to non-moderators (the public /api/backend/call door stays harmless).
    const modId = await maybeCurrentUserId(ctx);
    if (!modId) return [];
    const mod = await ctx.db.get(modId);
    if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return [];

    // Active = no end time (the by_active adapter path pushes IS NULL to SQL).
    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();

    const out = [];
    for (const shift of active) {
      const user = await ctx.db.get(shift.userId);
      // Owner directive 2026-08-26: seeded personas / e2e users never appear.
      if (!user || isDemoUser(user)) continue;

      // Shifts are derived from logs per site; the session's site comes from
      // the employee's latest log. No logs yet -> no site, no pin (the UI
      // lists them as "no GPS log yet" rather than inventing a position).
      const lastLogs = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", shift.userId))
        .order("desc")
        .take(1);
      const lastLog = lastLogs[0] ?? null;
      const site = lastLog?.siteId ? await ctx.db.get(lastLog.siteId) : null;

      out.push({
        _id: shift._id,
        userId: shift.userId,
        name: user.name ?? user.email ?? "unknown",
        startedAt: shift.startedAt,
        siteName: site?.name,
        siteLat: site?.latitude,
        siteLng: site?.longitude,
        siteRadiusMeters: site?.geofenceRadiusMeters,
        lastLog: lastLog
          ? {
              lat: lastLog.latitude,
              lng: lastLog.longitude,
              accuracyMeters: lastLog.accuracyMeters,
              clientReportedTime: lastLog.clientReportedTime,
              status: lastLog.status,
              isWithinGeofence: lastLog.isWithinGeofence,
            }
          : null,
      });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return out;
  },
});
