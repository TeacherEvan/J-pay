import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee } from "./access";
import { verifyDeviceToken } from "./deviceTokens";
import { haversineMeters } from "./geo";
import { api } from "./_generated/api";

const MAX_ACCURACY_METERS = 50;
const IMPOSSIBLE_TRAVEL_KMH = 200;
const RETENTION_DAYS = 90;

export const createLog = mutation({
  args: {
    siteId: v.id("sites"),
    clientReportedTime: v.number(),
    status: v.union(
      v.literal("arrived"),
      v.literal("checkpoint"),
      v.literal("lunch"),
      v.literal("feeling sick"),
      v.literal("day finish"),
      v.literal("job finish"),
      v.literal("quick side mission")
    ),
    latitude: v.number(),
    longitude: v.number(),
    accuracyMeters: v.number(),
    sideMissionDurationMinutes: v.optional(
      v.union(v.literal(15), v.literal(30), v.literal(45), v.literal(60), v.literal(120))
    ),
    deviceToken: v.string(),
    idempotencyKey: v.string(),
    deviceMetadata: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireEmployee(ctx);

    if (args.accuracyMeters > MAX_ACCURACY_METERS) {
      throw new ConvexError("WEAK_GPS_SIGNAL");
    }

    const user = await ctx.db.get(userId);
    if (!user || !verifyDeviceToken(args.deviceToken, userId, process.env.DEVICE_TOKEN_SECRET ?? "", user.deviceId)) {
      throw new ConvexError("DEVICE_TOKEN_INVALID");
    }

    const recent = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", userId).gte("_creationTime", Date.now() - 48 * 3600 * 1000)
      )
      .order("desc")
      .take(100);
    const duplicate = recent.find((l) => l.idempotencyKey === args.idempotencyKey);
    if (duplicate) return { logId: duplicate._id, duplicate: true as const };

    const site = await ctx.db.get(args.siteId);
    if (!site) throw new ConvexError("SITE_NOT_FOUND");
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (!assignments.some((a) => a.siteId === args.siteId)) {
      throw new ConvexError("SITE_NOT_ASSIGNED");
    }
    const isWithinGeofence =
      haversineMeters(args.latitude, args.longitude, site.latitude, site.longitude) <=
      site.geofenceRadiusMeters;

    const clockSkewMs = Date.now() - args.clientReportedTime;

    let impossibleTravelFlag: boolean | undefined = undefined;
    const previous = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    const prevFix = previous
      .filter((l) => Math.abs(l.clockSkewMs ?? 0) <= 30000)
      .sort((a, b) => b.clientReportedTime - a.clientReportedTime)[0];
    if (prevFix) {
      const hours = (args.clientReportedTime - prevFix.clientReportedTime) / 3600000;
      if (hours > 0) {
        const km =
          haversineMeters(prevFix.latitude, prevFix.longitude, args.latitude, args.longitude) / 1000;
        if (km / hours > IMPOSSIBLE_TRAVEL_KMH) impossibleTravelFlag = true;
      }
    }

    const logId = await ctx.db.insert("logs", {
      userId,
      siteId: args.siteId,
      clientReportedTime: args.clientReportedTime,
      clockSkewMs,
      status: args.status,
      latitude: args.latitude,
      longitude: args.longitude,
      accuracyMeters: args.accuracyMeters,
      isWithinGeofence,
      sideMissionDurationMinutes: args.sideMissionDurationMinutes,
      deviceMetadata: args.deviceMetadata,
      idempotencyKey: args.idempotencyKey,
      impossibleTravelFlag,
    });

    await ctx.scheduler.runAfter(0, api.shifts.deriveForUser, { userId });

    return { logId, duplicate: false as const };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireEmployee(ctx);
    return await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const purgeExpiredCoords = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    const expired = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) => q.lte("_creationTime", cutoff))
      .take(500);
    for (const log of expired) {
      if (log.latitude !== 0 || log.longitude !== 0) {
        await ctx.db.patch(log._id, { latitude: 0, longitude: 0 });
      }
    }
    return expired.length;
  },
});
