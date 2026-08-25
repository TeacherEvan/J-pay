import { action, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { DEMO_SITES, DEMO_SITE_TIMEZONE } from "./demo_sites";

export const status = query({
  args: {},
  handler: async () => ({ enabled: process.env.DEMO_MODE === "1" }),
});

const REVIEWER_MAX_AGE_DAYS = 7;

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

function jitter(base: number, spreadDeg = 0.0008): number {
  return base + (Math.random() - 0.5) * 2 * spreadDeg;
}

function buildRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  const now = new Date();
  let seq = 0;
  const dayStart = (daysAgo: number, hourUtc: number) => {
    const d = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d.getTime();
  };
  const push = (
    r: {
      siteName: string;
      email: string;
      employeeName: string;
      status: string;
      clientReportedTime: number;
      lat?: number;
      lng?: number;
      accuracyMeters?: number;
      clockSkewMs?: number;
      sideMissionDurationMinutes?: number;
    }
  ) => {
    const site = DEMO_SITES.find((s) => s.name === r.siteName)!;
    rows.push({
      ...r,
      accuracyMeters: r.accuracyMeters ?? 25,
      lat: r.lat ?? jitter(site.latitude),
      lng: r.lng ?? jitter(site.longitude),
      idempotencyKey: `demo:${r.email}:${r.clientReportedTime}:${seq++}`,
    } as SeedRow);
  };

  const personas = [
    { name: "Thabo Mokoena", email: "thabo.demo@jpay.local" },
    { name: "Sipho Ndlovu", email: "sipho.demo@jpay.local" },
    { name: "Lerato Khumalo", email: "lerato.demo@jpay.local" },
    { name: "David Miller", email: "david.demo@jpay.local" },
    { name: "Pieter van der Merwe", email: "pieter.demo@jpay.local" },
  ];

  for (let d = 13; d >= 1; d--) {
    const dow = new Date(dayStart(d, 6)).getUTCDay();
    if (dow === 0 || dow === 6) continue;

    // Thabo: clean days at JNB
    {
      const e = personas[0];
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(d, 6) });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "checkpoint", clientReportedTime: dayStart(d, 6) + 4 * 3600e3 });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "lunch", clientReportedTime: dayStart(d, 6) + 4.5 * 3600e3 });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "checkpoint", clientReportedTime: dayStart(d, 6) + 5.5 * 3600e3 });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(d, 6) + 9 * 3600e3 });
    }

    // Sipho: side missions, honestly closed out
    {
      const e = personas[1];
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(d, 7) });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "quick side mission", clientReportedTime: dayStart(d, 7) + 3 * 3600e3, sideMissionDurationMinutes: 35 });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "checkpoint", clientReportedTime: dayStart(d, 7) + 3 * 3600e3 + 32 * 60e3 });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(d, 7) + 9.5 * 3600e3 });
    }

    // Lerato: one excessive unpaired lunch (flagged review)
    {
      const e = personas[2];
      const lunchDay = Math.min(3, d);
      push({ siteName: "Midrand Distribution Hub", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(lunchDay, 6) });
      push({ siteName: "Midrand Distribution Hub", email: e.email, employeeName: e.name, status: "lunch", clientReportedTime: dayStart(lunchDay, 6) + 4 * 3600e3 });
      push({ siteName: "Midrand Distribution Hub", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(lunchDay, 6) + 8 * 3600e3 });
      if (d !== lunchDay) {
        push({ siteName: "Midrand Distribution Hub", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(d, 6) });
        push({ siteName: "Midrand Distribution Hub", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(d, 6) + 8.5 * 3600e3 });
      }
    }

    // David: JNB arrival then CPT fix minutes later -> impossible travel
    {
      const e = personas[3];
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(Math.min(2, d), 6) });
      push({
        siteName: "CPT Harbor Terminal",
        email: e.email,
        employeeName: e.name,
        status: "checkpoint",
        clientReportedTime: dayStart(Math.min(2, d), 6) + 12 * 60e3,
        lat: -33.9188,
        lng: 18.4233,
      });
      push({ siteName: "CPT Harbor Terminal", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(Math.min(2, d), 6) + 20 * 60e3 });
      push({ siteName: "CPT Harbor Terminal", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(Math.min(2, d), 6) + 8 * 3600e3 });
      if (d > 2) {
        push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(d, 6) });
        push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(d, 6) + 8 * 3600e3 });
      }
    }

    // Pieter: weak-but-passing GPS and a skewed clock
    {
      const e = personas[4];
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "arrived", clientReportedTime: dayStart(d, 8), accuracyMeters: 48, clockSkewMs: d === 5 ? 45000 : undefined });
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "job finish", clientReportedTime: dayStart(d, 8) + 8 * 3600e3, accuracyMeters: 47 });
    }
  }
  return rows;
}

export const seedDemoData = action({
  args: {},
  handler: async (ctx) => {
    if (process.env.DEMO_MODE !== "1") throw new ConvexError("DEMO_DISABLED");
    const callerId = await getAuthUserId(ctx);
    if (!callerId) throw new ConvexError("UNAUTHENTICATED");
    const caller = await ctx.runQuery(internal.users_queries.getById, { id: callerId });
    if (!caller || caller.role !== "moderator" || !caller.isActive || caller.archivedAt !== undefined) {
      throw new ConvexError("FORBIDDEN");
    }
    const rows = buildRows();
    const emails = [...new Set(rows.map((r) => r.email))];
    const result: { userIds: string[]; summary: { sites: number; employees: number; logsInserted: number; logsSkippedDuplicates: number } } =
      await ctx.runMutation(internal.demo_seed.seedAll, {
      createdBy: callerId,
      sites: DEMO_SITES.map((s) => ({ ...s })),
      rows,
      emails,
    });
    for (const userId of result.userIds) {
      await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, {
        userId: userId as import("./_generated/dataModel").Id<"users">,
      });
    }
    return result.summary;
  },
});

export const purgeStaleReviewers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - REVIEWER_MAX_AGE_DAYS * 24 * 3600 * 1000;
    const stale = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) => q.lte("_creationTime", cutoff))
      .take(100);
    let purged = 0;
    for (const user of stale) {
      if (user.isAnonymous !== true) continue;
      const logs = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", user._id))
        .collect();
      for (const log of logs) await ctx.db.delete(log._id);
      const shifts = await ctx.db
        .query("shifts")
        .withIndex("by_user_start", (q) => q.eq("userId", user._id))
        .collect();
      for (const shift of shifts) await ctx.db.delete(shift._id);
      const assignments = await ctx.db
        .query("userSites")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const a of assignments) await ctx.db.delete(a._id);
      const pushes = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const p of pushes) await ctx.db.delete(p._id);
      const messages = await ctx.db
        .query("messages")
        .filter(
          (q) =>
            q.or(q.eq(q.field("senderId"), user._id), q.eq(q.field("recipientId"), user._id))
        )
        .collect();
      for (const m of messages) await ctx.db.delete(m._id);
      const resolutions = await ctx.db
        .query("reviewResolutions")
        .withIndex("by_user_key", (q) => q.eq("userId", user._id))
        .collect();
      for (const r of resolutions) await ctx.db.delete(r._id);
      await ctx.db.delete(user._id);
      purged++;
    }
    return { purged };
  },
});
