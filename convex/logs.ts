import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee, maybeCurrentUserId } from "./access";
import { verifyDeviceToken } from "./deviceTokens";
import { haversineMeters } from "./geo";
import { internal } from "./_generated/api";
import { isDemoUser } from "./demo/scope";
import { serverClockSkewMs } from "../src/lib/shift-engine";
import { purgeExpiredTravelPathsInternal } from "./travel";

import { jpayConfig } from "../src/config/jpay.config";

const MAX_ACCURACY_METERS = jpayConfig.geoRules.maxAccuracyMeters;
const IMPOSSIBLE_TRAVEL_KMH = jpayConfig.geoRules.impossibleTravelSpeedKmh;
const RETENTION_DAYS = jpayConfig.geoRules.retentionDays;
const SKEW_TOLERANCE_MS = jpayConfig.laborRules.skewToleranceMs;

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
    /**
     * Client timestamp of when the entry was queued (offline) or pressed
     * (live). Clock skew is measured here, not at sync time, so an offline
     * shift keeps its real hours instead of collapsing to the replay instant.
     */
    queuedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireEmployee(ctx);

    if (args.accuracyMeters > MAX_ACCURACY_METERS) {
      throw new ConvexError("WEAK_GPS_SIGNAL");
    }

    const secret = process.env.DEVICE_TOKEN_SECRET;
    if (!secret) throw new ConvexError("DEVICE_TOKEN_SECRET_NOT_SET");
    const user = await ctx.db.get(userId);
    if (!user || !(await verifyDeviceToken(args.deviceToken, userId, secret, user.deviceId))) {
      throw new ConvexError("DEVICE_TOKEN_INVALID");
    }

    const duplicate = await ctx.db
      .query("logs")
      .withIndex("by_user_idem", (q) =>
        q.eq("userId", userId).eq("idempotencyKey", args.idempotencyKey)
      )
      .first();
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

    const clockSkewMs = serverClockSkewMs(args.clientReportedTime, args.queuedAt, Date.now());

    let impossibleTravelFlag: boolean | undefined = undefined;
    const previous = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    const prevFix = previous
      .sort((a, b) => b.clientReportedTime - a.clientReportedTime)[0];
    if (prevFix) {
      const aTime = Math.abs(clockSkewMs) <= SKEW_TOLERANCE_MS ? args.clientReportedTime : Date.now();
      const bTime = Math.abs(prevFix.clockSkewMs ?? 0) <= SKEW_TOLERANCE_MS ? prevFix.clientReportedTime : prevFix._creationTime;
      const hours = (aTime - bTime) / 3600000;
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

    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId });

    return { logId, duplicate: false as const };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await maybeCurrentUserId(ctx);
    if (!userId) return [];
    const u = await ctx.db.get(userId);
    if (!u || !u.isActive || u.archivedAt !== undefined || (u.role !== "employee" && u.role !== "manager")) return [];
    return await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const createLogAs = internalMutation({
  args: {
    reviewerId: v.id("users"),
    personaUserId: v.id("users"),
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
    if (args.accuracyMeters > MAX_ACCURACY_METERS) {
      throw new ConvexError("WEAK_GPS_SIGNAL");
    }

    const persona = await ctx.db.get(args.personaUserId);
    if (!persona || persona.archivedAt !== undefined || !persona.isActive) {
      throw new ConvexError("PERSONA_NOT_FOUND");
    }
    // SECURITY (2026-09-01): defence-in-depth — refuse to write a moderator-
    // overridden log against a non-demo (real) user. The reviewer may already
    // be required to be anonymous, but the persona target must also be demo.
    if (!isDemoUser(persona)) {
      throw new ConvexError("FORBIDDEN_DEMO_BOUNDARY");
    }
    const reviewer = await ctx.db.get(args.reviewerId);
    if (!reviewer || reviewer.isAnonymous !== true) {
      throw new ConvexError("FORBIDDEN");
    }

    const duplicate = await ctx.db
      .query("logs")
      .withIndex("by_user_idem", (q) =>
        q.eq("userId", args.personaUserId).eq("idempotencyKey", args.idempotencyKey)
      )
      .first();
    if (duplicate) return { logId: duplicate._id, duplicate: true as const };

    const site = await ctx.db.get(args.siteId);
    if (!site) throw new ConvexError("SITE_NOT_FOUND");
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.personaUserId))
      .collect();
    if (!assignments.some((a) => a.siteId === args.siteId)) {
      throw new ConvexError("SITE_NOT_ASSIGNED");
    }
    const isWithinGeofence =
      haversineMeters(args.latitude, args.longitude, site.latitude, site.longitude) <=
      site.geofenceRadiusMeters;

    const clockSkewMs = serverClockSkewMs(args.clientReportedTime, undefined, Date.now());

    let impossibleTravelFlag: boolean | undefined = undefined;
    const previous = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.personaUserId))
      .order("desc")
      .take(5);
    const prevFix = previous
      .sort((a, b) => b.clientReportedTime - a.clientReportedTime)[0];
    if (prevFix) {
      const aTime = Math.abs(clockSkewMs) <= SKEW_TOLERANCE_MS ? args.clientReportedTime : Date.now();
      const bTime = Math.abs(prevFix.clockSkewMs ?? 0) <= SKEW_TOLERANCE_MS ? prevFix.clientReportedTime : prevFix._creationTime;
      const hours = (aTime - bTime) / 3600000;
      if (hours > 0) {
        const km =
          haversineMeters(prevFix.latitude, prevFix.longitude, args.latitude, args.longitude) / 1000;
        if (km / hours > IMPOSSIBLE_TRAVEL_KMH) impossibleTravelFlag = true;
      }
    }

    const logId = await ctx.db.insert("logs", {
      userId: args.personaUserId,
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
      isModeratorOverride: true,
      createdByDemoReviewerId: args.reviewerId,
    });

    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, {
      userId: args.personaUserId,
    });

    return { logId, duplicate: false as const };
  },
});

export const purgeExpiredCoords = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await purgeExpiredCoordsHandler(ctx, {});
  },
});

export const purgeExpiredCoordsBatch = internalMutation({
  args: {
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await purgeExpiredCoordsHandler(ctx, args);
  },
});

async function purgeExpiredCoordsHandler(
  ctx: import("./_generated/server").MutationCtx,
  args: { cursor?: number }
) {
  // Same retention job also strips raw route samples from travel segments
  // (GDPR parity — logs anonymisation alone would leak paths). Direct call:
  // same process, same transaction semantics as the logs sweep itself.
  await purgeExpiredTravelPathsInternal(ctx);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const batch = await ctx.db
    .query("logs")
    .withIndex("by_creation_time", (q) =>
      args.cursor !== undefined
        ? q.gt("_creationTime", args.cursor).lte("_creationTime", cutoff)
        : q.lte("_creationTime", cutoff)
    )
    .take(200);

  if (batch.length === 0) return 0;

  let patchedCount = 0;
  for (const log of batch) {
    if (log.latitude !== 0 || log.longitude !== 0) {
      await ctx.db.patch(log._id, { latitude: 0, longitude: 0 });
      patchedCount++;
    }
  }

  const lastEntry = batch[batch.length - 1];
  const nextCursor = lastEntry._creationTime;

  if (patchedCount > 0) {
    await ctx.db.insert("purgeAudit", {
      purgedAt: Date.now(),
      purgedCount: patchedCount,
      kind: "coordinates",
    });
  }

  if (batch.length === 200 && nextCursor < cutoff) {
    await ctx.scheduler.runAfter(0, internal.logs.purgeExpiredCoordsBatch, {
      cursor: nextCursor,
    });
  }

  return patchedCount;
}
