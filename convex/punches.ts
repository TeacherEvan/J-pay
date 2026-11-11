import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee } from "./access";
import { haversineMeters } from "./geo";
import { verifyDeviceToken } from "./deviceTokens";
import { internal } from "./_generated/api";
import { jpayConfig } from "../src/config/jpay.config";
import { trailingWorkTimeWindow } from "../src/lib/travel-window";
import { findUnmatchedInPunch } from "../src/lib/punch-pairing";

const MAX_ACCURACY_METERS = jpayConfig.geoRules.maxAccuracyMeters;
const IMPOSSIBLE_TRAVEL_KMH = jpayConfig.geoRules.impossibleTravelSpeedKmh;

export const recordPunch = mutation({
  args: {
    siteId: v.id("sites"),
    type: v.union(v.literal("in"), v.literal("out")),
    lat: v.number(),
    lng: v.number(),
    accuracyMeters: v.optional(v.number()),
    deviceToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. AuthZ: require active employee
    const userId = await requireEmployee(ctx);

    // 2. Validate GPS accuracy if provided
    if (args.accuracyMeters !== undefined && args.accuracyMeters > MAX_ACCURACY_METERS) {
      throw new ConvexError("WEAK_GPS_SIGNAL");
    }

    // 3. Device token verification if provided
    if (args.deviceToken) {
      const secret = process.env.DEVICE_TOKEN_SECRET;
      if (!secret) throw new ConvexError("DEVICE_TOKEN_SECRET_NOT_SET");
      const user = await ctx.db.get(userId);
      if (!user || !(await verifyDeviceToken(args.deviceToken, userId, secret, user.deviceId))) {
        throw new ConvexError("DEVICE_TOKEN_INVALID");
      }
    }

    // 4. Site assignment check
    const assignment = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("siteId"), args.siteId))
      .first();
    if (!assignment) throw new ConvexError("SITE_NOT_ASSIGNED");

    // 5. Get site for geo
    const site = await ctx.db.get(args.siteId);
    if (!site || site.archivedAt !== undefined) throw new ConvexError("SITE_NOT_FOUND");

    // 6. Server-side haversine geo check
    const distance = haversineMeters(args.lat, args.lng, site.latitude, site.longitude);
    const geoPassed = distance <= site.geofenceRadiusMeters;

    // 7. Handle in/out pairing for duration
    let durationSec: number | undefined;
    if (args.type === "out") {
      const punches = await ctx.db
        .query("punches")
        .withIndex("by_user_site_time", (q) =>
          q.eq("userId", userId).eq("siteId", args.siteId)
        )
        .order("desc")
        .collect();
      // P2-B14: each `in` pairs at most once — skip ins already consumed
      // by a later `out`.
      const candidate = findUnmatchedInPunch(punches, Date.now());
      if (candidate) {
        durationSec = Math.floor((Date.now() - candidate.ts) / 1000);
      }
    }

    // 8. Insert punch into legacy punches table
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

    // 9. Impossible travel detection
    let impossibleTravelFlag: boolean | undefined = undefined;
    // P2-B13: order by WORK time, not insertion order — the index is
    // [userId] only, so .order("desc") walks _creationTime and mis-ranks
    // out-of-order offline replays. No clientReportedTime index exists
    // (no migrations allowed), so collect and rank in memory.
    const allPrior = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      // Bound the read: impossible-travel only needs the working horizon.
      // The adapter pushes gte into PostgREST (same pattern as the horizon
      // filter in derivation), so this is a bounded scan, not collect-all.
      .filter((q) => q.gte(q.field("clientReportedTime"), Date.now() - 48 * 3600 * 1000))
      .collect();
    const prevFix = trailingWorkTimeWindow(allPrior, 5)[0];
    if (prevFix) {
      const hours = (now - prevFix.clientReportedTime) / 3600000;
      if (hours > 0) {
        const km =
          haversineMeters(prevFix.latitude, prevFix.longitude, args.lat, args.lng) / 1000;
        if (km / hours > IMPOSSIBLE_TRAVEL_KMH) impossibleTravelFlag = true;
      }
    }

    // 10. Bridge to canonical shift engine logs so hours are payrolled
    await ctx.db.insert("logs", {
      userId,
      siteId: args.siteId,
      clientReportedTime: now,
      clockSkewMs: 0,
      status: args.type === "in" ? "arrived" : "day finish",
      latitude: args.lat,
      longitude: args.lng,
      accuracyMeters: args.accuracyMeters ?? 10,
      isWithinGeofence: geoPassed,
      deviceMetadata: "web-punch-clock",
      idempotencyKey: `punch-${punchId}`,
      impossibleTravelFlag,
    });

    // 11. Trigger shift rederivation for payroll
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