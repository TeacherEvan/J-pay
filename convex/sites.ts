import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId, requireEmployee, orgBoundaryOk, isQaAccount } from "./access";
import type { Id } from "./_generated/dataModel";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await maybeCurrentUserId(ctx);
    const viewerDoc = viewer ? await ctx.db.get(viewer) : null;
    if (!viewerDoc || !viewerDoc.isActive || viewerDoc.archivedAt !== undefined) return [];
    if (viewerDoc.role === "moderator") {
      const sites = await ctx.db.query("sites").collect();
      const out = [];
      for (const s of sites) {
        if (s.archivedAt !== undefined) continue;
        const creator = await ctx.db.get(s.createdBy);
        if (creator && isQaAccount(creator)) continue;
        out.push(s);
      }
      return out;
    }
    const userId = viewer as Id<"users">;
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const sites = [];
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (!site || site.archivedAt !== undefined) continue;
      const creator = await ctx.db.get(site.createdBy);
      if (creator && isQaAccount(creator)) continue;
      sites.push(site);
    }
    return sites;
  },
});

export const getSiteForPunch = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireEmployee(ctx);
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (!site || site.archivedAt !== undefined) continue;
      const creator = await ctx.db.get(site.createdBy);
      if (creator && isQaAccount(creator)) continue;
      return site;
    }
    return null;
  },
});

export const createSite = mutation({
  args: {
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusMeters: v.number(),
    timezone: v.string(),
    orgId: v.id("organisations"),
  },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.archivedAt !== undefined) throw new ConvexError("ORG_NOT_FOUND");
    const name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("INVALID_NAME");
    if (
      !Number.isFinite(args.latitude) ||
      Math.abs(args.latitude) > 90 ||
      !Number.isFinite(args.longitude) ||
      Math.abs(args.longitude) > 180
    ) {
      throw new ConvexError("INVALID_COORDS");
    }
    if (args.geofenceRadiusMeters <= 0 || args.geofenceRadiusMeters > 10000) {
      throw new ConvexError("GEOFENCE_RADIUS_OUT_OF_RANGE");
    }
    if (!args.timezone.includes("/")) throw new ConvexError("INVALID_TIMEZONE");
    return await ctx.db.insert("sites", {
      name,
      latitude: args.latitude,
      longitude: args.longitude,
      geofenceRadiusMeters: args.geofenceRadiusMeters,
      timezone: args.timezone,
      createdBy: moderatorId,
      orgId: args.orgId,
    });
  },
});

export const assignEmployee = mutation({
  args: { userId: v.id("users"), siteId: v.id("sites") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || (user.role !== "employee" && user.role !== "manager")) throw new ConvexError("NOT_AN_EMPLOYEE");
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new ConvexError("SITE_NOT_FOUND");
    if (!orgBoundaryOk(user.orgId, site.orgId)) {
      throw new ConvexError("CROSS_ORG_ASSIGNMENT_FORBIDDEN");
    }
    const existing = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.some((a) => a.siteId === args.siteId)) {
      throw new ConvexError("ALREADY_ASSIGNED");
    }
    await ctx.db.insert("userSites", { userId: args.userId, siteId: args.siteId });
  },
});

/**
 * Bulk multi-site assignment (owner 2026-11-10): the moderator picks the exact
 * set of sites for one employee/manager in one call. Convex mutations are a
 * single transaction, so the delete+insert below is atomic — no partial
 * assignments. Replaces the one-at-a-time assign/unassign loop.
 */
export const setEmployeeSites = mutation({
  args: {
    userId: v.id("users"),
    siteIds: v.array(v.id("sites")),
  },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || (user.role !== "employee" && user.role !== "manager")) {
      throw new ConvexError("NOT_AN_EMPLOYEE");
    }
    if (user.archivedAt !== undefined || !user.isActive) {
      throw new ConvexError("ACCOUNT_INACTIVE");
    }
    const uniqueSiteIds = [...new Set(args.siteIds)];
    const wanted = new Set<string>();
    for (const siteId of uniqueSiteIds) {
      const site = await ctx.db.get(siteId);
      if (!site) throw new ConvexError("SITE_NOT_FOUND");
      if (site.archivedAt !== undefined) throw new ConvexError("SITE_ARCHIVED");
      if (!orgBoundaryOk(user.orgId, site.orgId)) {
        throw new ConvexError("CROSS_ORG_ASSIGNMENT_FORBIDDEN");
      }
      wanted.add(siteId);
    }
    const existing = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    let unassigned = 0;
    for (const row of existing) {
      if (!wanted.has(row.siteId)) {
        await ctx.db.delete(row._id);
        unassigned++;
      }
    }
    const existingIds = new Set(existing.map((a) => a.siteId as string));
    let assigned = 0;
    for (const siteId of wanted) {
      if (!existingIds.has(siteId)) {
        await ctx.db.insert("userSites", { userId: args.userId, siteId: siteId as Id<"sites"> });
        assigned++;
      }
    }
    return { assigned, unassigned, total: wanted.size as number };
  },
});
