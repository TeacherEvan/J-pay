import { action, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireActiveUser } from "./access";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";
import { localDayKey } from "../src/lib/shift-engine";
import { computePay, type PayStrategyName } from "../src/lib/payroll-strategies";
import { toCsv } from "../src/lib/csv";
import { internal } from "./_generated/api";
import { jpayConfig } from "../src/config/jpay.config";

export const calcForEmployee = query({
  args: { userId: v.id("users"), fromMs: v.number(), toMs: v.number() },
  handler: async (ctx, args) => {
    const { userId: caller, role } = await requireActiveUser(ctx);
    if (role !== "moderator" && caller !== args.userId) throw new ConvexError("FORBIDDEN");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("USER_NOT_FOUND");
    const rate = user.hourlyRateOverride ?? Number(process.env.PAYROLL_DEFAULT_RATE ?? 0);

    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) =>
        q.eq("userId", args.userId).gte("startedAt", args.fromMs).lte("startedAt", args.toMs)
      )
      .collect();
    const inRange = shifts;

    let timezone = "UTC";
    const firstAssignment = await ctx.db
      .query("userSites")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (firstAssignment) {
      const site = await ctx.db.get(firstAssignment.siteId);
      timezone = site?.timezone ?? "UTC";
    }

    const days = new Map<string, number>();
    let payableMinutes = 0;
    const flagged: { startedAt: number; reason?: string; minutes?: number }[] = [];
    for (const s of inRange) {
      if (s.needsReview) {
        flagged.push({ startedAt: s.startedAt, reason: s.reviewReason, minutes: s.totalMinutes });
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
      (process.env.PAYROLL_STRATEGY as PayStrategyName | undefined) ?? undefined
    );
    for (const l of result.lines) payableMinutes += l.ordinaryMinutes + l.overtimeMinutes + l.sundayMinutes;

    return {
      rate,
      currency: process.env.PAYROLL_CURRENCY ?? jpayConfig.payrollRules.currency,
      strategy: result.strategy,
      timezone,
      days: result.lines.map((l) => ({ day: l.day, minutes: l.ordinaryMinutes + l.overtimeMinutes + l.sundayMinutes, pay: l.pay })),
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
