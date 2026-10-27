import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee } from "./access";
import { haversineMeters } from "./geo";
import { internal } from "./_generated/api";

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
      throw new ConvexError("GEOFENCE_FAILED");
    }

    // 5. Handle in/out pairing for duration
    // SECURITY/CORRECTNESS (2026-09-01): the previous implementation built a
    // set of "out" punch ids and then asked "is this in id in the out set?".
    // An in id is structurally never in the out set (different documents),
    // so the "is this in already paired?" check was always true and the
    // first in iteration order always won — pairing a 17:00 OUT against the
    // 08:00 IN instead of the 13:00 IN. The correct semantics: find the
    // latest IN whose ts is older than this OUT's now.
    let durationSec: number | undefined;
    if (args.type === "out") {
      const punches = await ctx.db
        .query("punches")
        .withIndex("by_user_site_time", (q) =>
          q.eq("userId", userId).eq("siteId", args.siteId)
        )
        .order("desc")
        .collect();
      // Find the latest "in" whose ts is in the past (i.e. not the current
      // one). We deliberately do not track "is this in already paired" in
      // the schema; the latest-in-before-out heuristic matches normal
      // sequential usage and is testable.
      const candidate = punches.find(
        (p) => p.type === "in" && p.ts < Date.now()
      );
      if (candidate) {
        durationSec = Math.floor((Date.now() - candidate.ts) / 1000);
      }
    }

    // 6. Insert punch into legacy punches table (backward compatibility)
    const now = Date.now();
    const punchId = await ctx.db.insert("punches", {
      userId,
      siteId: args.siteId,
      type: args.type,
      lat: args.lat,
      lng: args.lng,
      geoPassed,
      ts: now,
    });

    // 7. Bridge to canonical shift engine logs so hours are payrolled
    await ctx.db.insert("logs", {
      userId,
      siteId: args.siteId,
      clientReportedTime: now,
      clockSkewMs: 0,
      status: args.type === "in" ? "arrived" : "day finish",
      latitude: args.lat,
      longitude: args.lng,
      accuracyMeters: 10,
      isWithinGeofence: geoPassed,
      deviceMetadata: "web-punch-clock",
      idempotencyKey: `punch-${punchId}`,
    });

    // 8. Trigger shift rederivation for payroll
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId });

    return { punchId, geoPassed, durationSec, ts: now };
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

    // Note: using filter instead of index since punches index not yet in generated types
    return await ctx.db
      .query("punches")
      .filter((q) => q.and(q.eq(q.field("userId"), userId), q.eq(q.field("siteId"), args.siteId)))
      .order("desc")
      .take(50);
  },
});