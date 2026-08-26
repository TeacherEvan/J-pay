import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, maybeCurrentUserId } from "./access";
import type { Id } from "./_generated/dataModel";
import { isDemoUser } from "./demo_scope";

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
        const creator = await ctx.db.get(s.createdBy);
        if (creator && isDemoUser(creator)) continue;
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
      if (creator && isDemoUser(creator)) continue;
      sites.push(site);
    }
    return sites;
  },
});

export const createSite = mutation({
  args: {
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusMeters: v.number(),
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
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
    });
  },
});

export const assignEmployee = mutation({
  args: { userId: v.id("users"), siteId: v.id("sites") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || user.role !== "employee") throw new ConvexError("NOT_AN_EMPLOYEE");
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new ConvexError("SITE_NOT_FOUND");
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

export const unassignEmployee = mutation({
  args: { userId: v.id("users"), siteId: v.id("sites") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const rows = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const match = rows.find((a) => a.siteId === args.siteId);
    if (!match) throw new ConvexError("NOT_ASSIGNED");
    await ctx.db.delete(match._id);
  },
});
