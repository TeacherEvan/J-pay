import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { DEMO_SITE_TIMEZONE } from "./demo_sites";

type SeedRow = {
  siteName: string;
  email: string;
  employeeName: string;
  status: string;
  clientReportedTime: number;
  lat: number;
  lng: number;
  accuracyMeters: number;
  clockSkewMs?: number;
  sideMissionDurationMinutes?: number;
  idempotencyKey: string;
};

export const seedAll = internalMutation({
  args: {
    createdBy: v.id("users"),
    sites: v.array(
      v.object({
        name: v.string(),
        latitude: v.number(),
        longitude: v.number(),
        geofenceRadiusMeters: v.number(),
      })
    ),
    rows: v.array(
      v.object({
        siteName: v.string(),
        email: v.string(),
        employeeName: v.string(),
        status: v.string(),
        clientReportedTime: v.number(),
        lat: v.number(),
        lng: v.number(),
        accuracyMeters: v.number(),
        clockSkewMs: v.optional(v.number()),
        sideMissionDurationMinutes: v.optional(v.number()),
        idempotencyKey: v.string(),
      })
    ),
    emails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const siteIdByName = new Map<string, Id<"sites">>();
    for (const s of args.sites) {
      const existing = await ctx.db
        .query("sites")
        .filter((q) => q.eq(q.field("name"), s.name))
        .first();
      const id =
        existing?._id ??
        (await ctx.db.insert("sites", {
          ...s,
          timezone: DEMO_SITE_TIMEZONE,
          createdBy: args.createdBy,
        }));
      siteIdByName.set(s.name, id);
    }

    const userIdByEmail = new Map<string, Id<"users">>();
    for (const email of args.emails) {
      const existing = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (existing && existing.isActive && existing.archivedAt === undefined) {
        userIdByEmail.set(email, existing._id);
        continue;
      }
      const id = await ctx.db.insert("users", {
        email,
        name: args.rows.find((r) => r.email === email)?.employeeName ?? email,
        role: "employee",
        isActive: true,
        passwordChangedAt: Date.now(),
        emailVerificationTime: Date.now(),
      });
      userIdByEmail.set(email, id);
    }

    for (const [, siteId] of siteIdByName) {
      for (const [, userId] of userIdByEmail) {
        const assigned = await ctx.db
          .query("userSites")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .filter((q) => q.eq(q.field("siteId"), siteId))
          .first();
        if (!assigned) await ctx.db.insert("userSites", { userId, siteId });
      }
    }

    let inserted = 0;
    let skipped = 0;
    for (const r of args.rows) {
      const userId = userIdByEmail.get(r.email)!;
      const siteId = siteIdByName.get(r.siteName)!;
      const dup = await ctx.db
        .query("logs")
        .withIndex("by_user_idem", (q) =>
          q.eq("userId", userId).eq("idempotencyKey", r.idempotencyKey)
        )
        .first();
      if (dup) {
        skipped++;
        continue;
      }
      await ctx.db.insert("logs", {
        userId,
        siteId,
        idempotencyKey: r.idempotencyKey,
        clientReportedTime: r.clientReportedTime,
        clockSkewMs: r.clockSkewMs,
        status: r.status as SeedRow["status"] as never,
        latitude: r.lat,
        longitude: r.lng,
        accuracyMeters: r.accuracyMeters,
        isWithinGeofence: true,
        impossibleTravelFlag: false,
        deviceMetadata: "demo-seeder",
        sideMissionDurationMinutes: [15, 30, 45, 60, 120].includes(
          r.sideMissionDurationMinutes ?? 0
        )
          ? (r.sideMissionDurationMinutes as 15 | 30 | 45 | 60 | 120)
          : undefined,
      });
      inserted++;
    }
    return {
      userIds: [...userIdByEmail.values()],
      summary: { sites: siteIdByName.size, employees: userIdByEmail.size, logsInserted: inserted, logsSkippedDuplicates: skipped },
    };
  },
});
