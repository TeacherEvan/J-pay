import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { deriveSegments, type EngineLog, type ShiftOverride } from "../src/lib/shift-engine";
import type { Id } from "./_generated/dataModel";

/**
 * C1 (2026-11-10): called by the runtime's scheduled-job failure path AFTER
 * deriveForUser exhausts retries. Never throws; stamps the user's unsealed
 * shifts needsReview + records a systemEvents row. The punch log is valid
 * evidence — it is the shift cache that must not fail silently.
 */
export const markDerivationFailed = internalMutation({
  args: { userId: v.id("users"), detail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("systemEvents", {
      kind: "derivation_failed",
      userId: args.userId,
      at: now,
      detail: args.detail,
    });
    const userShifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of userShifts) {
      if (row.sealed === true) continue;
      if (row.needsReview && row.reviewReason === "derivation_failed") continue;
      await ctx.db.patch(row._id, { needsReview: true, reviewReason: "derivation_failed" });
    }
  },
});

const HORIZON_SAFETY_BUFFER_MS = 16 * 60 * 60 * 1000; // 16 hours

export const deriveForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // 1. Query existing shifts to find if any sealed shift exists
    const userShifts = await ctx.db
      .query("shifts")
      .withIndex("by_user_start", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    const latestSealed = userShifts.find((s) => s.sealed === true);
    const horizonCutoff = latestSealed !== undefined
      ? latestSealed.startedAt - HORIZON_SAFETY_BUFFER_MS
      : undefined;

    // 2. Fetch logs within the active horizon (or all logs if no sealed shift)
    let logsQuery = ctx.db
      .query("logs")
      .withIndex("by_user_time", (q) =>
        horizonCutoff !== undefined
          ? q.eq("userId", args.userId).gte("_creationTime", horizonCutoff - HORIZON_SAFETY_BUFFER_MS)
          : q.eq("userId", args.userId)
      );

    if (horizonCutoff !== undefined) {
      logsQuery = logsQuery.filter((q) =>
        q.gte(q.field("clientReportedTime"), horizonCutoff)
      );
    }

    const all = await logsQuery.collect();

    const siteIds = [...new Set(all.map((l) => l.siteId))];
    const tzBySite = new Map<Id<"sites">, string>();
    for (const siteId of siteIds) {
      const site = await ctx.db.get(siteId);
      if (site?.timezone) tzBySite.set(siteId, site.timezone);
    }

    const resolutions = await ctx.db
      .query("reviewResolutions")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
    const resolvedKeys = new Set(resolutions.map((r) => r.shiftKey));

    const engineLogs: EngineLog[] = all.map((l) => ({
      _creationTime: l._creationTime,
      idempotencyKey: l.idempotencyKey,
      clientReportedTime: l.clientReportedTime,
      clockSkewMs: l.clockSkewMs,
      status: l.status as string,
      sideMissionDurationMinutes: l.sideMissionDurationMinutes,
      siteTimezone: tzBySite.get(l.siteId),
      isWithinGeofence: l.isWithinGeofence,
      impossibleTravelFlag: l.impossibleTravelFlag,
    }));

    // Moderator end-of-shift overrides: latest per segment start wins.
    const overrideRows = await ctx.db
      .query("shiftOverrides")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
    // _id tie-break: _creationTime has millisecond precision and collapses
    // under fast double-writes; registries insert ids in monotonic-ish order
    // and no two rows share both _creationTime and _id.
    const latest = new Map<number, { createdAt: number; id: string; override: ShiftOverride }>();
    for (const row of overrideRows) {
      const key = Number(row.shiftKey);
      if (!Number.isFinite(key)) continue;
      const cur = latest.get(key);
      if (
        !cur ||
        row._creationTime > cur.createdAt ||
        (row._creationTime === cur.createdAt && String(row._id) > cur.id)
      ) {
        latest.set(key, {
          createdAt: row._creationTime,
          id: String(row._id),
          override: { endedAt: row.endedAt, reason: row.reason, overrideId: row._id },
        });
      }
    }
    const overrides =
      latest.size > 0 ? new Map([...latest].map(([k, v]) => [k, v.override])) : undefined;

    const segments = deriveSegments(engineLogs, overrides);

    // 3. Reconcile in place instead of delete+insert (audit 2026-11-11, P2-B3).
    // Unsealed rows are matched to segments by `startedAt`:
    //   * matched  → patched in place (row _id preserved; stable cache lineage)
    //   * unmatched existing → deleted (stale segment no longer derivable)
    //   * unmatched segment   → inserted (new segment)
    // Sealed rows stay frozen. Combined with 0015's unique index on
    // shifts("userId","startedAt"), a concurrent double-insert fails loudly
    // (constraint error → derivation_failed marker) instead of duplicating pay.
    const sealedStarts = new Set(
      userShifts.filter((r) => r.sealed === true).map((r) => r.startedAt)
    );

    // Group by startedAt; if legacy duplicates exist (pre-0015), keep the
    // earliest-created row, delete the rest — deterministic convergence to
    // one row per (userId, startedAt) even before the unique index exists.
    const grouped = new Map<number, typeof userShifts>();
    for (const row of userShifts) {
      if (row.sealed === true) continue;
      if (horizonCutoff !== undefined && row.startedAt < horizonCutoff) continue;
      const list = grouped.get(row.startedAt) ?? [];
      list.push(row);
      grouped.set(row.startedAt, list);
    }
    const existingUnsealed = new Map<number, typeof userShifts[number]>();
    for (const [startedAt, rows] of grouped) {
      rows.sort((a, b) => a._creationTime - b._creationTime);
      existingUnsealed.set(startedAt, rows[0]);
      for (const dup of rows.slice(1)) {
        await ctx.db.delete(dup._id);
      }
    }

    const derived = new Map<number, (typeof segments)[number]>();
    for (const seg of segments) {
      if (sealedStarts.has(seg.startedAt)) continue;
      if (horizonCutoff !== undefined && seg.startedAt < horizonCutoff) continue;
      if (
        seg.needsReview &&
        resolvedKeys.has(String(seg.startedAt))
      ) {
        seg.needsReview = false;
        seg.reviewReason = `resolved:${seg.reviewReason ?? "flagged"}`;
      }
      derived.set(seg.startedAt, seg);
    }

    for (const [startedAt, row] of existingUnsealed) {
      if (!derived.has(startedAt)) {
        await ctx.db.delete(row._id);
      }
    }

    for (const [startedAt, seg] of derived) {
      const row: {
        userId: typeof args.userId;
        startedAt: number;
        endedAt?: number;
        totalMinutes?: number;
        needsReview: boolean;
        reviewReason?: string;
        timezone?: string;
        sealed?: boolean;
      } = {
        userId: args.userId,
        startedAt,
        needsReview: seg.needsReview,
      };
      if (seg.endedAt !== undefined) row.endedAt = seg.endedAt;
      if (seg.totalMinutes !== undefined) row.totalMinutes = seg.totalMinutes;
      if (seg.reviewReason !== undefined) row.reviewReason = seg.reviewReason;
      if (seg.timezone !== undefined) row.timezone = seg.timezone;
      const prior = existingUnsealed.get(startedAt);
      if (prior) {
        // _id preserved across re-derivation: upsert, not delete+insert.
        await ctx.db.patch(prior._id, row);
      } else {
        await ctx.db.insert("shifts", row);
      }
    }
  },
});
