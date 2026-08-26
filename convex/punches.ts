import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const recordPunch = mutation({
  args: {
    userId: v.id("users"),
    siteId: v.id("sites"),
    type: v.union(v.literal("in"), v.literal("out")),
    lat: v.number(),
    lng: v.number(),
    geoPassed: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Degraded deliverable: minimal gate; full auth/access check deferred
    return await ctx.db.insert("punches", {
      userId: args.userId,
      siteId: args.siteId,
      type: args.type,
      lat: args.lat,
      lng: args.lng,
      geoPassed: args.geoPassed,
      ts: Date.now(),
    });
  },
});
