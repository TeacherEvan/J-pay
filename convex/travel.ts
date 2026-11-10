import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireEmployee, maybeCurrentUserId, requireActiveUser } from "./access";
import { verifyDeviceToken } from "./deviceTokens";
import { haversineMeters } from "./geo";
import { serverClockSkewMs } from "../src/lib/shift-engine";
import { jpayConfig } from "../src/config/jpay.config";
import { isDemoUser } from "./demo/scope";
import { managedSiteIds } from "./manager";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const MAX_ACCURACY_METERS = jpayConfig.geoRules.maxAccuracyMeters;
const IMPOSSIBLE_TRAVEL_KMH = jpayConfig.geoRules.impossibleTravelSpeedKmh;
const RETENTION_DAYS = jpayConfig.geoRules.retentionDays;
const SKEW_TOLERANCE_MS = jpayConfig.laborRules.skewToleranceMs;

/** Client throttles to ~15s; the server never stores more than this in one segment. */
const SAMPLE_MIN_INTERVAL_MS = 10_000;
const SAMPLE_MIN_LEG_METERS = 25;
const MAX_SAMPLES_PER_SEGMENT = 300;
const GPS_GAP_MS = 5 * 60 * 1000;
const GPS_GAP_METERS = 500;

// Statuses in which the employee is not working/travelling (substates to the
// open shift). The server — like the shift engine — treats the LATEST log as
// the truth for phase; holding one of these pauses travel tracking even if a
// client keeps streaming fixes.
const PAUSED_STATUSES = new Set(["lunch", "quick side mission", "feeling sick"]);

type PathSample = { lat: number; lng: number; t: number; s?: number };

/**
 * Travel tracking (owner 2026-11-10): on-shift, off-site only, consent-gated.
 * The server — never the client — decides whether a fix is stored, whether the
 * employee is inside an assigned geofence (fix dropped, open segment closed),
 * or travelling (fix appended to the open segment, one opened if none exists).
 * Travel fixes are evidence/visibility for managers and audit; payroll is NOT
 * derived from them (the shift span already contains in-shift travel).
 */

export const setConsent = mutation({
  args: { consent: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await requireEmployee(ctx);
    await ctx.db.patch(userId, { travelConsentAt: args.consent ? Date.now() : undefined });
    return { travelConsentAt: args.consent ? Date.now() : undefined };
  },
});

export const recordFix = mutation({
  args: {
    latitude: v.number(),
    longitude: v.number(),
    accuracyMeters: v.number(),
    clientReportedTime: v.number(),
    deviceToken: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireEmployee(ctx);

    if (!Number.isFinite(args.latitude) || Math.abs(args.latitude) > 90) {
      throw new ConvexError("INVALID_COORDS");
    }
    if (!Number.isFinite(args.longitude) || Math.abs(args.longitude) > 180) {
      throw new ConvexError("INVALID_COORDS");
    }
    if (args.accuracyMeters > MAX_ACCURACY_METERS) {
      throw new ConvexError("WEAK_GPS_SIGNAL");
    }

    const secret = process.env.DEVICE_TOKEN_SECRET;
    if (!secret) throw new ConvexError("DEVICE_TOKEN_SECRET_NOT_SET");
    const user = await ctx.db.get(userId);
    if (!user || !(await verifyDeviceToken(args.deviceToken, userId, secret, user.deviceId))) {
      throw new ConvexError("DEVICE_TOKEN_INVALID");
    }

    const openShifts = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();
    const openShift = openShifts.find((s) => s.userId === userId);

    // Responsible-stop: shift ended (or forgotten past the 16h auto-close, which
    // the derivation closes server-side) — flag any still-open segment for review
    // and tell the client to stand down.
    if (!openShift) {
      const mine = await ctx.db
        .query("travelSegments")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const seg of mine) {
        if (seg.arrivedAt !== undefined) continue;
        if (!seg.needsReview) {
          await ctx.db.patch(seg._id, {
            needsReview: true,
            reviewReason: "shift_ended_during_travel",
          });
        }
      }
      return { status: "shift_inactive" as const };
    }

    // Consent gate — nothing is written without it.
    if (!user.travelConsentAt) {
      return { status: "consent_required" as const };
    }

    // Phase gate — lunch / side mission / sick leave are never tracked.
    const lastLogs = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);
    const lastStatus = lastLogs[0]?.status;
    if (lastStatus && PAUSED_STATUSES.has(lastStatus)) {
      return { status: "shift_break" as const };
    }

    const skewMs = serverClockSkewMs(args.clientReportedTime, undefined, Date.now());
    const t = Math.abs(skewMs) <= SKEW_TOLERANCE_MS ? args.clientReportedTime : Date.now();

    // Resolve whether the employee is inside any assigned geofence.
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const inside: Array<{ siteId: typeof assignments[number]["siteId"]; name: string }> = [];
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (!site || site.archivedAt !== undefined) continue;
      const d = haversineMeters(args.latitude, args.longitude, site.latitude, site.longitude);
      if (d <= site.geofenceRadiusMeters) inside.push({ siteId: a.siteId, name: site.name });
    }

    const mine = await ctx.db
      .query("travelSegments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const openSegment = mine.find((s) => s.arrivedAt === undefined);

    // Inside an assigned geofence: close any open leg, store nothing.
    if (inside.length > 0) {
      if (openSegment) {
        await ctx.db.patch(openSegment._id, {
          arrivedAt: t,
          toSiteId: inside[0].siteId,
        });
        return { status: "recorded" as const, mode: "arrived" as const, siteId: inside[0].siteId };
      }
      return { status: "recorded" as const, mode: "on_site" as const, siteId: inside[0].siteId };
    }

    // Off-site, on-shift: append to (or open) the travel leg.
    if (!openSegment) {
      // fromSiteId: best-effort "departed from" — the employee's last logged site.
      const lastLogs = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .order("desc")
        .take(1);
      const lastLog = lastLogs[0];
      const fromSiteId = lastLog?.isWithinGeofence ? lastLog.siteId : undefined;
      const samples: PathSample[] = [{ lat: args.latitude, lng: args.longitude, t }];
      const segmentId = await ctx.db.insert("travelSegments", {
        userId,
        fromSiteId,
        departedAt: t,
        distanceMeters: 0,
        pathSamples: samples,
        lastFixKey: args.idempotencyKey,
        needsReview: false,
      });
      return { status: "recorded" as const, mode: "traveling" as const, segmentId, distanceMeters: 0 };
    }

    // Idempotent replay of the exact last fix (offline outbox double-fire).
    if (openSegment.lastFixKey === args.idempotencyKey) {
      return { status: "duplicate" as const };
    }

    const samples = (openSegment.pathSamples ?? []) as PathSample[];
    const last = samples[samples.length - 1];
    const legMeters = last
      ? haversineMeters(last.lat, last.lng, args.latitude, args.longitude)
      : 0;
    const legMs = last ? t - last.t : Number.POSITIVE_INFINITY;

    // Nothing meaningful moved or too soon — acknowledge without storing.
    if (last && legMs < SAMPLE_MIN_INTERVAL_MS && legMeters < SAMPLE_MIN_LEG_METERS) {
      return {
        status: "recorded" as const,
        mode: "traveling" as const,
        segmentId: openSegment._id,
        distanceMeters: openSegment.distanceMeters,
        throttled: true as const,
      };
    }

    const legSeconds = Math.max(1, legMs / 1000);
    const speedMps = legMeters / legSeconds;
    const impossible = speedMps > (IMPOSSIBLE_TRAVEL_KMH * 1000) / 3600;
    const gpsGap = Boolean(
      last && legMs > GPS_GAP_MS && legMeters > GPS_GAP_METERS
    );

    let needsReview = openSegment.needsReview;
    let reviewReason = openSegment.reviewReason;
    if (impossible) {
      needsReview = true;
      reviewReason = "impossible_travel";
    } else if (gpsGap) {
      needsReview = true;
      reviewReason = "gps_gap";
    }

    const capped = samples.length >= MAX_SAMPLES_PER_SEGMENT;
    if (capped) {
      needsReview = true;
      reviewReason = "path_truncated";
    } else {
      samples.push({ lat: args.latitude, lng: args.longitude, t, s: speedMps });
    }

    const maxSpeedMps = Math.max(openSegment.maxSpeedMps ?? 0, speedMps);
    await ctx.db.patch(openSegment._id, {
      pathSamples: samples,
      distanceMeters: openSegment.distanceMeters + legMeters,
      maxSpeedMps,
      lastFixKey: args.idempotencyKey,
      needsReview,
      reviewReason,
    });

    return {
      status: "recorded" as const,
      mode: "traveling" as const,
      segmentId: openSegment._id,
      distanceMeters: openSegment.distanceMeters + legMeters,
      impossibleTravel: impossible || undefined,
    };
  },
});

/**
 * Who may see whom's travel legs: the employee themself; a manager for any
 * crew member (assigned to one of the manager's managed sites); moderators
 * for anyone (audit). Everyone else gets [].
 */
export const forUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { userId: viewerId, role } = await requireActiveUser(ctx);
    if (role !== "moderator" && role !== "manager" && viewerId !== args.userId) {
      throw new ConvexError("FORBIDDEN");
    }
    if (role === "manager") {
      const siteIds = await managedSiteIds(ctx, viewerId);
      if (siteIds.size === 0) return [];
      const assignments = await ctx.db
        .query("userSites")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      if (!assignments.some((a) => siteIds.has(a.siteId))) return [];
    }

    const segments = await ctx.db
      .query("travelSegments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);

    const siteCache = new Map<string, string | undefined>();
    const siteName = async (siteId?: string) => {
      if (!siteId) return undefined;
      if (!siteCache.has(siteId)) {
        const site = await ctx.db.get(siteId as Id<"sites">);
        siteCache.set(siteId, site && "name" in site ? site.name : undefined);
      }
      return siteCache.get(siteId);
    };

    const out = [];
    for (const seg of segments) {
      out.push({
        _id: seg._id,
        departedAt: seg.departedAt,
        arrivedAt: seg.arrivedAt,
        distanceMeters: seg.distanceMeters,
        maxSpeedMps: seg.maxSpeedMps,
        sampleCount: (seg.pathSamples ?? []).length,
        fromSiteName: await siteName(seg.fromSiteId),
        toSiteName: await siteName(seg.toSiteId),
        needsReview: seg.needsReview,
        reviewReason: seg.reviewReason,
      });
    }
    return out;
  },
});

/**
 * Manager console feed: recent travel legs across the whole crew (open and
 * closed), newest first, capped. Viewer must be a real (non-demo) manager.
 */
export const recentForCrew = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const viewerId = await maybeCurrentUserId(ctx);
    if (!viewerId) return [];
    const viewer = await ctx.db.get(viewerId);
    if (!viewer || viewer.role !== "manager" || !viewer.isActive || viewer.archivedAt !== undefined) {
      return [];
    }
    if (isDemoUser(viewer)) return [];

    const siteIds = await managedSiteIds(ctx, viewerId);
    if (siteIds.size === 0) return [];

    const assignments = await ctx.db.query("userSites").collect();
    const crewIds = new Set<string>();
    for (const a of assignments) {
      if (siteIds.has(a.siteId)) crewIds.add(a.userId);
    }
    if (crewIds.size === 0) return [];

    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const merged: Array<{
      _id: Id<"travelSegments">;
      userId: Id<"users">;
      employeeName: string;
      departedAt: number;
      arrivedAt?: number;
      distanceMeters: number;
      maxSpeedMps?: number;
      sampleCount: number;
      needsReview: boolean;
      reviewReason?: string;
      fromSiteId?: Id<"sites">;
      toSiteId?: Id<"sites">;
    }> = [];
    for (const crewId of crewIds) {
      const segments = await ctx.db
        .query("travelSegments")
        .withIndex("by_user", (q) => q.eq("userId", crewId as Id<"users">))
        .collect();
      const user = await ctx.db.get(crewId as Id<"users">);
      const employeeName = user?.name ?? user?.email ?? "unknown";
      for (const seg of segments) {
        merged.push({
          _id: seg._id,
          userId: crewId as Id<"users">,
          employeeName,
          departedAt: seg.departedAt,
          arrivedAt: seg.arrivedAt,
          distanceMeters: seg.distanceMeters,
          maxSpeedMps: seg.maxSpeedMps,
          sampleCount: (seg.pathSamples ?? []).length,
          needsReview: seg.needsReview,
          reviewReason: seg.reviewReason,
          fromSiteId: seg.fromSiteId,
          toSiteId: seg.toSiteId,
        });
      }
    }
    merged.sort((a, b) => b.departedAt - a.departedAt);

    const siteCache = new Map<string, string | undefined>();
    const siteName = async (siteId?: Id<"sites">) => {
      if (!siteId) return undefined;
      if (!siteCache.has(siteId)) {
        const site = await ctx.db.get(siteId);
        siteCache.set(siteId, site?.name);
      }
      return siteCache.get(siteId);
    };

    const out = [];
    for (const seg of merged.slice(0, limit)) {
      out.push({
        _id: seg._id,
        userId: seg.userId,
        employeeName: seg.employeeName,
        departedAt: seg.departedAt,
        arrivedAt: seg.arrivedAt,
        distanceMeters: seg.distanceMeters,
        maxSpeedMps: seg.maxSpeedMps,
        sampleCount: seg.sampleCount,
        needsReview: seg.needsReview,
        reviewReason: seg.reviewReason,
        fromSiteName: await siteName(seg.fromSiteId),
        toSiteName: await siteName(seg.toSiteId),
      });
    }
    return out;
  },
});

/**
 * GDPR anonymisation: raw route samples older than the retention window are
 * dropped (aggregated distance/duration are kept for payroll evidence).
 * Chained from logs.purgeExpiredCoords — same retention job, direct call,
 * no scheduler round-trip. Cursor-paginates to completion (cap 50 × 200).
 */
export async function purgeExpiredTravelPathsInternal(
  ctx: MutationCtx
): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  let cursor: number | undefined = undefined;
  let patched = 0;
  for (let iteration = 0; iteration < 50; iteration++) {
    const batch = await ctx.db
      .query("travelSegments")
      .withIndex("by_creation_time", (q) =>
        cursor !== undefined
          ? q.gt("_creationTime", cursor).lte("_creationTime", cutoff)
          : q.lte("_creationTime", cutoff)
      )
      .take(200);
    if (batch.length === 0) break;
    for (const seg of batch) {
      if ((seg.pathSamples ?? []).length > 0) {
        await ctx.db.patch(seg._id, { pathSamples: [] });
        patched++;
      }
    }
    const last = batch[batch.length - 1];
    cursor = last._creationTime;
    if (batch.length < 200) break;
  }
  if (patched > 0) {
    await ctx.db.insert("purgeAudit", {
      purgedAt: Date.now(),
      purgedCount: patched,
      kind: "coordinates",
    });
  }
  return patched;
}
