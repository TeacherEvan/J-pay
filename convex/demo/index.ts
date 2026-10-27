import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "../_generated/api";
import { DEMO_SITES, DEMO_SITE_TIMEZONE } from "./sites";
import { requireDemoReviewer } from "../access";
import { isDemoUser } from "./scope";
import { localDayKey } from "../../src/lib/shift-engine";
import { computePay, type PayStrategyName } from "../../src/lib/payroll-strategies";
import { toCsv } from "../../src/lib/csv";
import { jpayConfig } from "../../src/config/jpay.config";

export const status = query({
  args: {},
  handler: async () => ({ enabled: process.env.DEMO_MODE === "1" }),
});

function requireDemoMode() {
  if (process.env.DEMO_MODE !== "1") {
    throw new ConvexError("DEMO_DISABLED");
  }
}

const REVIEWER_MAX_AGE_DAYS = 7;

export const DEMO_PERSONAS = [
  { name: "Thabo Mokoena", email: "thabo.demo@jpay.local", rate: 180 },
  { name: "Sipho Ndlovu", email: "sipho.demo@jpay.local", rate: 220 },
  { name: "Lerato Khumalo", email: "lerato.demo@jpay.local", rate: 195 },
  { name: "David Miller", email: "david.demo@jpay.local", rate: 240 },
  { name: "Pieter van der Merwe", email: "pieter.demo@jpay.local", rate: 165 },
] as const;

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

  const personas = DEMO_PERSONAS;

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
      push({ siteName: "JNB Central Depot", email: e.email, employeeName: e.name, status: "quick side mission", clientReportedTime: dayStart(d, 7) + 3 * 3600e3, sideMissionDurationMinutes: 45 });
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
    requireDemoMode();
    const callerId = await getAuthUserId(ctx);
    if (!callerId) throw new ConvexError("UNAUTHENTICATED");
    const caller = await ctx.runQuery(internal.users_queries.getById, { id: callerId });
    if (!caller || (caller.role !== "moderator" && caller.isAnonymous !== true) || !caller.isActive || caller.archivedAt !== undefined) {
      throw new ConvexError("FORBIDDEN");
    }
    const rows = buildRows();
    const emails = [...new Set(rows.map((r) => r.email))];
    const ratesByEmail = Object.fromEntries(DEMO_PERSONAS.map((p) => [p.email, p.rate]));
    const result: { userIds: string[]; summary: { sites: number; employees: number; logsInserted: number; logsSkippedDuplicates: number } } =
      await ctx.runMutation(internal.demo.seedAll, {
      createdBy: callerId,
      sites: DEMO_SITES.map((s) => ({ ...s })),
      rows,
      emails,
      ratesByEmail,
    });
    for (const userId of result.userIds) {
      await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, {
        userId: userId as import("../_generated/dataModel").Id<"users">,
      });
    }
    return result.summary;
  },
});

export const _resolveDemoReviewer = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await requireDemoReviewer(ctx);
  },
});

export const bindReviewer = mutation({
  args: { personaEmail: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireDemoReviewer(ctx);
    const persona = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.personaEmail))
      .first();
    // SECURITY (2026-09-01): reject binds to non-demo personas. The old check
    // only excluded anonymous users, which let any real employee be bound.
    if (!persona || persona.role !== "employee" || !isDemoUser(persona) || persona.archivedAt !== undefined || !persona.isActive) {
      throw new ConvexError("PERSONA_NOT_FOUND");
    }
    const session = await ctx.db
      .query("demoSessions")
      .withIndex("by_reviewer", (q) => q.eq("reviewerId", userId))
      .first();
    const now = Date.now();
    if (session) {
      await ctx.db.patch(session._id, { personaEmail: args.personaEmail, updatedAt: now });
    } else {
      await ctx.db.insert("demoSessions", {
        reviewerId: userId,
        personaEmail: args.personaEmail,
        mode: "full",
        createdAt: now,
        updatedAt: now,
      });
    }
    // B2 (2026-08-26): ensure persona has site assignments before the
    // CheckInPanel tries to render a site picker. Idempotent — safe to
    // call on every bind.
    await ctx.runMutation(internal.demo.ensurePersonaSiteAssignments, {
      personaUserId: persona._id,
    });
    return { userId, personaUserId: persona._id, personaName: persona.name ?? args.personaEmail };
  },
});

export const getBinding = query({
  args: {},
  handler: async (ctx) => {
    const binding = await requireDemoReviewer(ctx);
    const persona = await ctx.db.get(binding.personaUserId);
    const reviewer = await ctx.db.get(binding.userId);
    return {
      reviewerId: binding.userId,
      reviewerName: reviewer?.name ?? "Demo reviewer",
      personaUserId: binding.personaUserId,
      personaEmail: binding.personaEmail,
      personaName: persona?.name ?? binding.personaEmail,
      personaHasSites: (await ctx.db
        .query("userSites")
        .withIndex("by_user", (q) => q.eq("userId", binding.personaUserId))
        .first()) !== null,
    };
  },
});

export const boundPersonaLogs = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    return await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", personaUserId))
      .order("desc")
      .take(200);
  },
});

export const boundPersonaShifts = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    return await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", personaUserId))
      .order("desc")
      .take(100);
  },
});

export const boundPersonaPayroll = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const persona = await ctx.db.get(personaUserId);
    const rate = persona?.hourlyRateOverride ?? Number(process.env.PAYROLL_DEFAULT_RATE ?? 0);
    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", personaUserId))
      .collect();
    const timezone = "UTC";
    const days = new Map<string, number>();
    for (const s of shifts) {
      if (s.needsReview) continue;
      const key = localDayKey(s.startedAt, (s as { timezone?: string }).timezone ?? timezone);
      days.set(key, (days.get(key) ?? 0) + (s.totalMinutes ?? 0));
    }
    const result = computePay(
      [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, minutes]) => ({ day, minutes })),
      rate,
      (process.env.PAYROLL_STRATEGY as PayStrategyName | undefined) ?? undefined
    );
    const totals = {
      minutes:
        result.totals.ordinaryMinutes + result.totals.overtimeMinutes + result.totals.sundayMinutes,
      pay: result.totals.pay,
    };
    return {
      rate,
      currency: process.env.PAYROLL_CURRENCY ?? jpayConfig.payrollRules.currency,
      locale: persona?.locale ?? "en-ZA",
      days: result.lines.map((l) => ({
        day: l.day,
        minutes: l.ordinaryMinutes + l.overtimeMinutes + l.sundayMinutes,
        pay: l.pay,
      })),
      totals,
    };
  },
});

export const demoAudit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const all = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 7 * 24 * 3600 * 1000)
      )
      .order("desc")
      .take(args.limit ?? 100);
    const filtered = all.filter((l) => l.userId === personaUserId);
    return await Promise.all(
      filtered.map(async (log) => ({
        _id: log._id,
        status: log.status,
        at: log.clientReportedTime,
        accuracyMeters: log.accuracyMeters,
        clockSkewMs: log.clockSkewMs ?? 0,
        isWithinGeofence: log.isWithinGeofence,
        impossibleTravelFlag: log.impossibleTravelFlag === true,
        siteName: "(seeded)",
      }))
    );
  },
});

export const demoNeedsReview = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", personaUserId))
      .order("desc")
      .take(100);
    return rows.filter((s) => s.needsReview).slice(0, 50);
  },
});

export const demoKpis = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const active = await ctx.db
      .query("shifts")
      .withIndex("by_active", (q) => q.eq("endedAt", undefined))
      .collect();
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const weekShifts = await ctx.db
      .query("shifts")
      .withIndex("by_started", (q) => q.gte("startedAt", weekAgo))
      .collect();
    const weeklyBillableMinutes = weekShifts
      .filter((s) => s.userId === personaUserId && !s.needsReview)
      .reduce((a, s) => a + (s.totalMinutes ?? 0), 0);
    const flagged = await ctx.db
      .query("shifts")
      .withIndex("by_needs_review", (q) => q.eq("needsReview", true))
      .collect();
    const recentLogs = await ctx.db
      .query("logs")
      .withIndex("by_creation_time", (q) =>
        q.gte("_creationTime", Date.now() - 24 * 3600 * 1000)
      )
      .take(1000);
    const anomalies24h = recentLogs.filter(
      (l) => l.userId === personaUserId && (l.isWithinGeofence === false || l.impossibleTravelFlag === true)
    ).length;
    return {
      activeOnSite: active.filter((s) => s.userId === personaUserId).length,
      weeklyBillableMinutes,
      pendingReviews: flagged.filter((s) => s.userId === personaUserId).length,
      anomalies24h,
      demoModeEnabled: true,
    };
  },
});

export const demoEmployeeRoster = query({
  args: {},
  handler: async (ctx) => {
    await requireDemoReviewer(ctx);
    // SECURITY (2026-09-01): only return demo personas. Previously this
    // returned every non-anonymous employee, giving demo visitors a
    // directory of real employees to target with the bind exploit.
    const employees = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .take(50);
    return employees.filter((u) => isDemoUser(u) && u.isAnonymous !== true);
  },
});

export const checkInAsPersona = action({
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
    const binding: { userId: import("../_generated/dataModel").Id<"users">; personaUserId: import("../_generated/dataModel").Id<"users"> } =
      await ctx.runQuery(internal.demo._resolveDemoReviewer, {});
    const result: { logId: import("../_generated/dataModel").Id<"logs">; duplicate: boolean } =
      await ctx.runMutation(internal.logs.createLogAs, {
        reviewerId: binding.userId,
        personaUserId: binding.personaUserId,
        ...args,
      });
    return result;
  },
});

export const switchPersona = mutation({
  args: { personaEmail: v.string() },
  handler: async (ctx, args) => {
    const binding = await requireDemoReviewer(ctx);
    const persona = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.personaEmail))
      .first();
    // SECURITY (2026-09-01): mirror the bindReviewer check — refuse to switch
    // the bound persona to a non-demo (real) employee.
    if (!persona || persona.role !== "employee" || !isDemoUser(persona) || persona.archivedAt !== undefined || !persona.isActive) {
      throw new ConvexError("PERSONA_NOT_FOUND");
    }
    const session = await ctx.db
      .query("demoSessions")
      .withIndex("by_reviewer", (q) => q.eq("reviewerId", binding.userId))
      .first();
    if (!session) throw new ConvexError("DEMO_SESSION_NOT_BOUND");
    await ctx.db.patch(session._id, {
      personaEmail: args.personaEmail,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, {
      userId: persona._id,
    });
    return { personaName: persona.name ?? args.personaEmail };
  },
});

export const demoExportLogsCsv = action({
  args: { fromMs: v.number(), toMs: v.number() },
  handler: async (ctx, args) => {
    const binding: { userId: import("../_generated/dataModel").Id<"users">; personaUserId: import("../_generated/dataModel").Id<"users"> } =
      await ctx.runQuery(internal.demo._resolveDemoReviewer, {});
    const { rows }: { rows: { clientTime: number; serverTime: number; status: string; lat: number; lng: number; accuracyMeters: number; geofence: boolean; travelFlag: boolean; skewSeconds: number }[]; truncated: boolean } =
      await ctx.runQuery(internal.payroll_data.logsForExport, {
        userId: binding.personaUserId,
        fromMs: args.fromMs,
        toMs: args.toMs,
      });
    const csv = toCsv(
      [
        "client_time_utc",
        "server_time_utc",
        "status",
        "lat",
        "lng",
        "accuracy_m",
        "geofence",
        "travel_flag",
        "skew_s",
      ],
      rows.map((l) => [
        new Date(l.clientTime).toISOString(),
        new Date(l.serverTime).toISOString(),
        l.status,
        l.lat,
        l.lng,
        l.accuracyMeters,
        l.geofence ? "in" : "out",
        l.travelFlag ? "flagged" : "",
        l.skewSeconds,
      ])
    );
    return {
      filename: `jpay-logs-demo-${binding.personaUserId}-${new Date(args.fromMs).toISOString().slice(0, 10)}.csv`,
      csv,
    };
  },
});

export const demoModeratorInbox = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const all = await ctx.db
      .query("messages")
      .withIndex("by_modqueue_unread", (q) => q.eq("modQueue", true))
      .take(150);
    const filtered = all.filter((m) => m.senderId === personaUserId);
    return filtered.map((m) => ({
      _id: m._id,
      senderId: m.senderId,
      content: m.content,
      isRead: m.isRead,
      at: m._creationTime,
      senderName: "persona",
    }));
  },
});

export const demoReplyToEmployee = mutation({
  args: { recipientId: v.id("users"), content: v.string() },
  handler: async (ctx, args) => {
    const { userId: reviewerId, personaUserId } = await requireDemoReviewer(ctx);
    const text = args.content.trim();
    if (!text || text.length > 2000) throw new ConvexError("INVALID_CONTENT");
    if (args.recipientId !== personaUserId) {
      throw new ConvexError("OUT_OF_DEMO_SCOPE");
    }
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient) throw new ConvexError("USER_NOT_FOUND");
    if (recipient.role !== "employee" || recipient.isAnonymous === true) {
      throw new ConvexError("OUT_OF_DEMO_SCOPE");
    }
    const messageId = await ctx.db.insert("messages", {
      senderId: reviewerId,
      recipientId: args.recipientId,
      modQueue: false,
      content: text,
      isRead: false,
    });
    return { messageId };
  },
});

export const demoMarkQueueItemRead = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new ConvexError("MESSAGE_NOT_FOUND");
    if (message.senderId !== personaUserId) {
      throw new ConvexError("OUT_OF_DEMO_SCOPE");
    }
    await ctx.db.patch(args.messageId, { isRead: true });
    return { ok: true as const };
  },
});

export const demoResolveShift = mutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const { userId: reviewerId, personaUserId } = await requireDemoReviewer(ctx);
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new ConvexError("SHIFT_NOT_FOUND");
    // SECURITY (2026-09-01): refuse to resolve a shift that does not belong to
    // the bound demo persona. Previously any shift id could be sealed.
    if (shift.userId !== personaUserId) {
      throw new ConvexError("FORBIDDEN_DEMO_BOUNDARY");
    }
    await ctx.db.patch(args.shiftId, {
      needsReview: false,
      reviewReason: `resolved:${shift.reviewReason ?? "flagged"}`,
      sealed: true,
    });
    await ctx.db.insert("reviewResolutions", {
      userId: shift.userId,
      shiftKey: String(shift.startedAt),
      resolvedAt: Date.now(),
      byModeratorId: reviewerId,
    });
  },
});

export const demoRecomputeEmployeeShifts = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    // SECURITY (2026-09-01): refuse to recompute arbitrary employees; only
    // the bound persona is eligible.
    if (args.userId !== personaUserId) {
      throw new ConvexError("FORBIDDEN_DEMO_BOUNDARY");
    }
    await ctx.scheduler.runAfter(0, internal.shifts.deriveForUser, { userId: args.userId });
  },
});

export const purgeStaleReviewers = internalMutation({
  args: {},
  handler: async (ctx) => {
    requireDemoMode();
    const cutoff = Date.now() - REVIEWER_MAX_AGE_DAYS * 24 * 3600 * 1000;
    const stale = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) => q.lte("_creationTime", cutoff))
      .filter((q) => q.eq(q.field("isAnonymous"), true))
      .take(100);
    let purged = 0;
    for (const user of stale) {
      if (user.isAnonymous !== true) continue;
      const logs = await ctx.db
        .query("logs")
        .withIndex("by_user_time", (q) => q.eq("userId", user._id))
        .collect();
      for (const log of logs) await ctx.db.delete(log._id);
      const reviewerLogs = await ctx.db
        .query("logs")
        .filter((q) => q.eq(q.field("createdByDemoReviewerId"), user._id))
        .collect();
      for (const log of reviewerLogs) await ctx.db.delete(log._id);
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
      const sent = await ctx.db
        .query("messages")
        .withIndex("by_sender", (q) => q.eq("senderId", user._id))
        .collect();
      for (const m of sent) await ctx.db.delete(m._id);
      const receivedUnread = await ctx.db
        .query("messages")
        .withIndex("by_recipient_read", (q) => q.eq("recipientId", user._id).eq("isRead", false))
        .collect();
      for (const m of receivedUnread) await ctx.db.delete(m._id);
      const receivedRead = await ctx.db
        .query("messages")
        .withIndex("by_recipient_read", (q) => q.eq("recipientId", user._id).eq("isRead", true))
        .collect();
      for (const m of receivedRead) await ctx.db.delete(m._id);
      const resolutions = await ctx.db
        .query("reviewResolutions")
        .filter((q) =>
          q.or(
            q.eq(q.field("userId"), user._id),
            q.eq(q.field("byModeratorId"), user._id)
          )
        )
        .collect();
      for (const r of resolutions) await ctx.db.delete(r._id);
      const sessions = await ctx.db
        .query("demoSessions")
        .withIndex("by_reviewer", (q) => q.eq("reviewerId", user._id))
        .collect();
      for (const s of sessions) await ctx.db.delete(s._id);
      await ctx.db.delete(user._id);
      purged++;
    }
    return { purged };
  },
});

/**
 * B2 (2026-08-26): ensure a persona user has userSites rows for every
 * active site. Called idempotently by bindReviewer/getBinding so demo
 * personas always have site assignments even if the original seeder
 * didn't backfill them.
 */
export const ensurePersonaSiteAssignments = internalMutation({
  args: { personaUserId: v.id("users") },
  handler: async (ctx, args) => {
    requireDemoMode();
    const demoNames = new Set<string>(DEMO_SITES.map((d) => d.name));
    const allSites = await ctx.db
      .query("sites")
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();
    const sites = allSites.filter((s) => demoNames.has(s.name));
    const existing = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.personaUserId))
      .collect();
    const assignedSiteIds = new Set(existing.map((a) => a.siteId));
    let created = 0;
    for (const site of sites) {
      if (!assignedSiteIds.has(site._id)) {
        await ctx.db.insert("userSites", { userId: args.personaUserId, siteId: site._id });
        created++;
      }
    }
    return created;
  },
});

/**
 * B2: return the persona's assigned active sites for the CheckInPanel.
 * Only one site in the full-payroll demo, but this is the correct query
 * regardless.
 */
export const boundPersonaSites = query({
  args: {},
  handler: async (ctx) => {
    const { personaUserId } = await requireDemoReviewer(ctx);
    const assignments = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", personaUserId))
      .collect();
    const sites = [];
    for (const a of assignments) {
      const site = await ctx.db.get(a.siteId);
      if (site && site.archivedAt === undefined) sites.push(site);
    }
    return sites;
  },
});
