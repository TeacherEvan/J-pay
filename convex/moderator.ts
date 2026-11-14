import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId, isQaAccount, orgUsers } from "./access";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Moderator + live org, or null (queries degrade to [] for anyone else). */
async function modOrgScope(ctx: QueryCtx, orgId: Id<"organisations">) {
  const modId = await maybeCurrentUserId(ctx);
  if (!modId) return null;
  const mod = await ctx.db.get(modId);
  if (!mod || mod.role !== "moderator" || !mod.isActive || mod.archivedAt !== undefined) return null;
  const org = await ctx.db.get(orgId);
  if (!org || org.archivedAt !== undefined) return null;
  return mod;
}

async function requireTargetInLiveOrg(ctx: MutationCtx, userId: Id<"users">) {
  const target = await ctx.db.get(userId);
  if (!target || isQaAccount(target) || !target.orgId || !(await modOrgScope(ctx, target.orgId))) {
    throw new ConvexError("FORBIDDEN");
  }
  return target;
}


export const auditRecentLogs = query({
  args: { orgId: v.id("organisations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!(await modOrgScope(ctx, args.orgId))) return [];
    const limit = args.limit ?? 100;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    // Filter-then-limit: per org member, newest first, merged. A busier org
    // can never starve this one (take-before-filter bug, audit F4).
    const members = await orgUsers(ctx, args.orgId, { includeInactive: true });
    const byId = new Map(members.map((u) => [u._id as string, u]));
    const logs = [];
    for (const u of members) {
      const rows = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", u._id))
        .order("desc")
        .take(limit);
      for (const r of rows) if (r._creationTime >= cutoff) logs.push(r);
    }
    logs.sort((x, y) => y._creationTime - x._creationTime);
    const page = logs.slice(0, limit);
    const siteCache = new Map<string, Awaited<ReturnType<typeof ctx.db.get<"sites">>>>();
    const out = [];
    for (const log of page) {
      const user = byId.get(log.userId as string);
      let site = siteCache.get(log.siteId as string);
      if (site === undefined) {
        site = await ctx.db.get(log.siteId);
        siteCache.set(log.siteId as string, site);
      }
      out.push({
        _id: log._id,
        userId: log.userId,
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
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    if (!(await modOrgScope(ctx, args.orgId))) return [];
    const members = await orgUsers(ctx, args.orgId, { includeInactive: true });
    const byId = new Map(members.map((u) => [u._id as string, u]));
    const flagged = await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .collect();
    return flagged
      .filter((s) => byId.has(s.userId as string))
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 50)
      .map((s) => {
        const u = byId.get(s.userId as string)!;
        return { ...s, employeeName: u.name ?? u.email ?? "unknown" };
      });
  },
});

export const listEmployeesWithAssignments = query({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    if (!(await modOrgScope(ctx, args.orgId))) return [];
    // The roster is the moderator's MANAGEMENT surface: archived accounts stay
    // visible so they can be cleaned up. QA rows are excluded from counts/audit
    // elsewhere; here they are kept only if they belong to this org.
    const rows = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const people = rows.filter((u) => u.role === "employee" || u.role === "manager");
    const out = [];
    for (const e of people) {
      const links = await ctx.db
        .query("userSites")
        .withIndex("by_user", (q) => q.eq("userId", e._id))
        .collect();
      const siteNames: string[] = [];
      for (const l of links) {
        const site = await ctx.db.get(l.siteId);
        if (site && "name" in site) siteNames.push(site.name);
      }
      out.push({
        _id: e._id,
        role: e.role,
        name: e.name,
        email: e.email,
        orgId: e.orgId,
        archivedAt: e.archivedAt,
        isActive: e.isActive,
        deviceId: e.deviceId,
        hourlyRateOverride: e.hourlyRateOverride,
        locale: e.locale,
        assignedSiteIds: links.map((l) => l.siteId),
        siteNames,
      });
    }
    out.sort((a, b) => String(a.name ?? a.email).localeCompare(String(b.name ?? b.email)));
    return out;
  },
});

export const listAllSites = query({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    if (!(await modOrgScope(ctx, args.orgId))) return [];
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    return sites.filter((s) => s.archivedAt === undefined);
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
    await requireTargetInLiveOrg(ctx, shift.userId);
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
    await requireTargetInLiveOrg(ctx, args.userId);
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId: args.userId });
  },
});

export const setHourlyOverride = mutation({
  args: { userId: v.id("users"), rate: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await requireTargetInLiveOrg(ctx, args.userId);
    if (args.rate !== undefined && (!Number.isFinite(args.rate) || args.rate < 0 || args.rate > 100000)) {
      throw new ConvexError("RATE_OUT_OF_RANGE");
    }
    await ctx.db.patch(args.userId, { hourlyRateOverride: args.rate });
  },
});

/**
 * Open or recently-closed, non-sealed shifts a moderator may correct the end
 * of. Throwaway QA accounts and sealed (payroll-finalized) rows are excluded —
 * the override mutation refuses them too.
 */
export const overridableShifts = query({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    if (!(await modOrgScope(ctx, args.orgId))) return [];
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const members = await orgUsers(ctx, args.orgId);
    const out = [];
    for (const user of members) {
      const rows = await ctx.db
        .query("shifts")
        .withIndex("by_user_start", (q) => q.eq("userId", user._id).gte("startedAt", cutoff))
        .collect();
      for (const shift of rows) {
        if (shift.sealed === true) continue;
        out.push({
          _id: shift._id,
          userId: shift.userId,
          employeeName: user.name ?? user.email ?? "unknown",
          startedAt: shift.startedAt,
          endedAt: shift.endedAt,
          totalMinutes: shift.totalMinutes,
          needsReview: shift.needsReview,
          reviewReason: shift.reviewReason,
          hasOverride: (shift.reviewReason ?? "").startsWith("moderator_override"),
        });
      }
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out.slice(0, 60);
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
    await requireTargetInLiveOrg(ctx, shift.userId);
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
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    // Sibling of auditRecentLogs: moderator-gated, QA-filtered, returns []
    // to non-moderators (the public /api/backend/call door stays harmless).
    if (!(await modOrgScope(ctx, args.orgId))) return [];

    // Active = no end time (the by_active adapter path pushes IS NULL to SQL).
    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();

    const out = [];
    for (const shift of active) {
      const user = await ctx.db.get(shift.userId);
      // Owner directive 2026-08-26: throwaway QA users never appear.
      if (!user || isQaAccount(user) || user.orgId !== args.orgId) continue;

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
