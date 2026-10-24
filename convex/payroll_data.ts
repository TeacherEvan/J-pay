import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const logsForExport = internalQuery({
  args: { userId: v.id("users"), fromMs: v.number(), toMs: v.number() },
  handler: async (ctx, args) => {
    // Payroll periods are defined by when the work happened, not when the
    // row reached the server. Filtering on _creationTime silently dropped
    // offline-replayed logs that synced after the period closed.
    const logs = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .collect();
    const inRange = logs
      .filter((l) => l.clientReportedTime >= args.fromMs && l.clientReportedTime < args.toMs)
      .sort((a, b) => a.clientReportedTime - b.clientReportedTime);
    const rows = inRange.slice(0, 5000).map((l) => ({
      clientTime: l.clientReportedTime,
      serverTime: l._creationTime,
      status: l.status as string,
      lat: l.latitude,
      lng: l.longitude,
      accuracyMeters: l.accuracyMeters,
      geofence: l.isWithinGeofence,
      travelFlag: l.impossibleTravelFlag === true,
      skewSeconds: Math.round((l.clockSkewMs ?? 0) / 1000),
    }));
    return { rows, truncated: inRange.length > 5000 };
  },
});
