import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee } from "./access";
import { haversineMeters } from "./geo";
import type { Id } from "./_generated/dataModel";

export const recordPunch = mutation({
  args: {
    siteId: v.id("sites"),
    type: v.union(v.literal("in"), v.literal("out")),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. AuthZ: require active employee
    const userId = await requireEmployee(ctx);

    // 2. Site assignment check
    const assignment = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("siteId"), args.siteId))
      .first();
    if (!assignment) throw new ConvexError("SITE_NOT_ASSIGNED");

    // 3. Get site for geo
    const site = await ctx.db.get(args.siteId);
    if (!site || site.archivedAt !== undefined) throw new ConvexError("SITE_NOT_FOUND");

    // 4. Server-side haversine geo check
    const distance = haversineMeters(args.lat, args.lng, site.latitude, site.longitude);
    const geoPassed = distance <= site.geofenceRadiusMeters;
    if (!geoPassed) {
      throw new ConvexError("GEOFENCE_FAILED", {
        distance: Math.round(distance),
        radius: site.geofenceRadiusMeters,
      });
    }

    // 5. Handle in/out pairing for duration
    let durationSec: number | undefined;
    if (args.type === "out") {
      // Find latest unpaired "in" punch for this user+site
      const punches = await ctx.db
        .query("punches")
        .withIndex("by_user_site_time", (q) => q.eq("userId", userId).eq("siteId", args.siteId))
        .order("desc")
        .collect();
      
      // Find the latest "in" that doesn't have a matching "out"
      let lastInId: Id<"punches"> | null = null;
      const outPunchIds = new Set<Id<"punches">>();
      
      // First pass: collect all "out" punch IDs
      for (const p of punches) {
        if (p.type === "out") outPunchIds.add(p._id);
      }
      
      // Second pass: find latest "in" without matching "out"
      for (const p of punches) {
        if (p.type === "in" && !outPunchIds.has(p._id)) {
          lastInId = p._id;
          break;
        }
      }
      
      if (lastInId) {
        const lastIn = await ctx.db.get(lastInId);
        if (lastIn) {
          durationSec = Math.floor((Date.now() - lastIn.ts) / 1000);
        }
      }
    }

    // 6. Insert punch
    const punchId = await ctx.db.insert("punches", {
      userId,
      siteId: args.siteId,
      type: args.type,
      lat: args.lat,
      lng: args.lng,
      geoPassed,
      ts: Date.now(),
    });

    return { punchId, geoPassed, durationSec, ts: Date.now() };
  },
});

// Helper query for punch history (optional, for UI)
export const getPunchHistory = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, args) => {
    const userId = await requireEmployee(ctx);
    const assignment = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("siteId"), args.siteId))
      .first();
    if (!assignment) throw new ConvexError("SITE_NOT_ASSIGNED");

    return await ctx.db
      .query("punches")
      .withIndex("by_user_site_time", (q) => q.eq("userId", userId).eq("siteId", args.siteId))
      .order("desc")
      .take(50);
  },
});