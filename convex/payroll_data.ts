import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const logsForExport = internalQuery({
  args: { userId: v.id("users"), fromMs: v.number(), toMs: v.number() },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", args.userId).gte("_creationTime", args.fromMs)
      )
      .order("asc")
      .take(5000);
    return logs.filter((l) => l._creationTime < args.toMs).map((l) => ({
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
  },
});
