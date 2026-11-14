import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireActiveUser, requireModerator, requireOrgScope, orgUsers } from "./access";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";
import { localDayKey } from "../src/lib/shift-engine";
import { computePay, type PayStrategyName } from "../src/lib/payroll-strategies";
import { listSupportedJurisdictions, getPayStrategy } from "../src/lib/payroll-jurisdictions";
import { toCsv } from "../src/lib/csv";
import { internal } from "./_generated/api";
import { jpayConfig } from "../src/config/jpay.config";
import { siteWeekRange } from "../src/lib/iso-week";

/** Caller's intent, not a ms window — the server derives ISO-week bounds in the SITE's timezone. */
interface PeriodIntent {
  anchorMs: number;
  weeks: 1 | 2 | 4;
  weekOffset: number;
}

interface SiteTimezoneAssignment { timezone?: string | null }

async function siteTimezoneFor(ctx: QueryCtx, userId: Doc<"users">["_id"]): Promise<string> {
  const firstAssignment = await ctx.db
    .query("userSites")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!firstAssignment) return "UTC";
  const site = await ctx.db.get(firstAssignment.siteId);
  const tz = (site as SiteTimezoneAssignment | null)?.timezone;
  return tz && tz.length > 0 ? tz : "UTC";
}

async function computeEmployeePayroll(ctx: QueryCtx, user: Doc<"users">, intent: PeriodIntent) {
    // Config integrity (audit P2-B4/B5): a missing rate pays R0.00 in silence, and
    // an unrecognised PAYROLL_STRATEGY silently degrades to flat-rate pay. Fail
    // loudly instead — these are payroll bugs, not inputs.
    const envStrategy = process.env.PAYROLL_STRATEGY;
    const KNOWN_STRATEGIES: readonly string[] = ["flat", "bcea", "dailyOvertime", "flsa", "wtr_uk"];
    if (envStrategy !== undefined && !KNOWN_STRATEGIES.includes(envStrategy)) {
      throw new ConvexError("INVALID_PAYROLL_STRATEGY");
    }
    if (user.payStrategy !== undefined && !KNOWN_STRATEGIES.includes(user.payStrategy)) {
      throw new ConvexError("INVALID_PAYROLL_STRATEGY");
    }
    const rate = user.hourlyRateOverride ?? Number(process.env.PAYROLL_DEFAULT_RATE ?? 0);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new ConvexError("RATE_NOT_CONFIGURED");
    }
    const effectiveStrategy: PayStrategyName =
      user.payStrategy ??
      (process.env.PAYROLL_STRATEGY as PayStrategyName | undefined) ??
      jpayConfig.payrollRules.strategy;

    // Resolve the site's timezone FIRST — the ISO-week bounds are computed there,
    // not in the caller's zone (audit F2: local weeks under-select behind-site shifts).
    const timezone = await siteTimezoneFor(ctx, user._id);
    const period = siteWeekRange(intent.anchorMs, timezone, intent.weeks, intent.weekOffset);

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) =>
        q.eq("userId", user._id).gte("startedAt", period.fromMs).lte("startedAt", period.toMs)
      )
      .collect();
    const inRange = shifts;

    const days = new Map<string, number>();
    let payableMinutes = 0;
    const flagged: { startedAt: number; reason?: string; minutes?: number }[] = [];
    for (const s of inRange) {
      if (s.needsReview) {
        flagged.push({ startedAt: s.startedAt, reason: s.reviewReason, minutes: s.totalMinutes });
        continue;
      }
      if (s.endedAt === undefined) {
        continue;
      }
      const key = localDayKey(
        s.startedAt,
        (s as { timezone?: string }).timezone ?? timezone
      );
      const mins = s.totalMinutes ?? 0;
      days.set(key, (days.get(key) ?? 0) + mins);
    }
    const result = computePay(
      [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, minutes]) => ({ day, minutes })),
      rate,
      effectiveStrategy
    );
    for (const l of result.lines) payableMinutes += l.ordinaryMinutes + l.overtimeMinutes + l.sundayMinutes;

    return {
      rate,
      currency: process.env.PAYROLL_CURRENCY ?? jpayConfig.payrollRules.currency,
      strategy: result.strategy,
      locale: user.locale ?? "en-ZA",
      timezone,
      days: result.lines.map((l) => ({ day: l.day, minutes: l.ordinaryMinutes + l.overtimeMinutes + l.sundayMinutes, pay: l.pay })),
      period,
      totals: {
        payableMinutes,
        pay: result.totals.pay,
        ordinaryMinutes: result.totals.ordinaryMinutes,
        overtimeMinutes: result.totals.overtimeMinutes,
        sundayMinutes: result.totals.sundayMinutes,
        shiftCount: inRange.length,
        flaggedCount: flagged.length,
      },
      flagged,
    };
}

/** Intent validators shared by the two payroll queries — the server owns the clock arithmetic. */
const periodIntentValidator = {
  weeks: v.union(v.literal(1), v.literal(2), v.literal(4)),
  weekOffset: v.number(),
  anchorMs: v.number(),
};

export const calcForEmployee = query({
  args: { userId: v.id("users"), ...periodIntentValidator },
  handler: async (ctx, args) => {
    const { userId: caller, role } = await requireActiveUser(ctx);
    if (role !== "moderator" && caller !== args.userId) throw new ConvexError("FORBIDDEN");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("USER_NOT_FOUND");
    return computeEmployeePayroll(ctx, user, { weeks: args.weeks, weekOffset: args.weekOffset, anchorMs: args.anchorMs });
  },
});

/**
 * Org-wide payroll summary (moderator). One row per active member; a member
 * with no rate / bad strategy yields a status row instead of failing the table.
 */
export const calcForOrg = query({
  args: { orgId: v.id("organisations"), ...periodIntentValidator },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await requireOrgScope(ctx, args.orgId);
    const intent: PeriodIntent = { weeks: args.weeks, weekOffset: args.weekOffset, anchorMs: args.anchorMs };
    const rows = [];
    for (const user of await orgUsers(ctx, args.orgId)) {
      const base = { userId: user._id, name: user.name ?? user.email ?? "unknown", email: user.email, role: user.role };
      try {
        const r = await computeEmployeePayroll(ctx, user, intent);
        rows.push({
          ...base,
          status: "ok" as const,
          rate: r.rate,
          currency: r.currency,
          locale: r.locale,
          strategy: r.strategy,
          period: r.period,
          ...r.totals,
        });
      } catch (e) {
        const msg = e instanceof ConvexError ? String(e.data) : "ERROR";
        rows.push({ ...base, status: msg === "RATE_NOT_CONFIGURED" ? ("no_rate" as const) : ("error" as const), error: msg });
      }
    }
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return rows;
  },
});

export const setPayStrategy = mutation({
  args: {
    userId: v.id("users"),
    strategy: v.union(
      v.literal("flat"),
      v.literal("bcea"),
      v.literal("dailyOvertime"),
      v.literal("flsa"),
      v.literal("wtr_uk")
    ),
  },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("USER_NOT_FOUND");
    await ctx.db.patch(args.userId, { payStrategy: args.strategy });
    return { ok: true as const };
  },
});

export const listSupportedStrategies = query({
  args: {},
  handler: async (ctx) => {
    await requireActiveUser(ctx);
    return listSupportedJurisdictions();
  },
});

export const exportLogsCsv = action({
  args: { userId: v.id("users"), fromMs: v.number(), toMs: v.number() },
  handler: async (ctx, args) => {
    const callerId = await getAuthUserId(ctx);
    if (!callerId) throw new ConvexError("UNAUTHENTICATED");
    const caller = await ctx.runQuery(internal.users_queries.getById, { id: callerId });
    if (!caller || caller.role !== "moderator" || !caller.isActive || caller.archivedAt !== undefined) {
      throw new ConvexError("FORBIDDEN");
    }
    const { rows, truncated } = await ctx.runQuery(internal.payroll_data.logsForExport, args);
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
      rows.map(
        (l: {
          clientTime: number;
          serverTime: number;
          status: string;
          lat: number;
          lng: number;
          accuracyMeters: number;
          geofence: boolean;
          travelFlag: boolean;
          skewSeconds: number;
        }) => [
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
    if (truncated) {
      return {
        filename: `jpay-logs-TRUNCATED-5000-${args.userId}.csv`,
        csv,
      };
    }
    return {
      filename: `jpay-logs-${args.userId}-${new Date(args.fromMs).toISOString().slice(0, 10)}.csv`,
      csv,
    };
  },
});
