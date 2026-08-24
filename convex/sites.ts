import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireModerator, requireActiveUser } from "./access";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { userId, role } = await requireActiveUser(ctx);
    if (role === "moderator") {
      return await ctx.db.query("sites").collect();
    }
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const sites = [];
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (site && site.archivedAt === undefined) sites.push(site);
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
    if (args.geofenceRadiusMeters <= 0 || args.geofenceRadiusMeters > 10000) {
      throw new Error("GEOFENCE_RADIUS_OUT_OF_RANGE");
    }
    return await ctx.db.insert("sites", {
      ...args,
      createdBy: moderatorId,
    });
  },
});

export const assignEmployee = mutation({
  args: { userId: v.id("users"), siteId: v.id("sites") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || user.role !== "employee") throw new Error("NOT_AN_EMPLOYEE");
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("SITE_NOT_FOUND");
    const existing = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.some((a) => a.siteId === args.siteId)) {
      throw new Error("ALREADY_ASSIGNED");
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
    if (!match) throw new Error("NOT_ASSIGNED");
    await ctx.db.delete(match._id);
  },
});
