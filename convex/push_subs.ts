import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { currentUserId } from "./access";

export const publicVapidKey = query({
  args: {},
  handler: async () => {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  },
});

export const saveSubscription = mutation({
  args: { endpoint: v.string(), keysP256dh: v.string(), keysAuth: v.string() },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((s) => s.endpoint === args.endpoint);
    if (match) {
      await ctx.db.patch(match._id, {
        keysP256dh: args.keysP256dh,
        keysAuth: args.keysAuth,
      });
      return match._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: args.endpoint,
      keysP256dh: args.keysP256dh,
      keysAuth: args.keysAuth,
    });
  },
});

/** Owner-facing opt-out: remove the caller's subscription for `endpoint`
 * (or all of the caller's subscriptions when omitted). */
export const deleteMySubscription = mutation({
  args: { endpoint: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUserId(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let removed = 0;
    for (const row of rows) {
      if (args.endpoint === undefined || row.endpoint === args.endpoint) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }
    return { removed };
  },
});

export const subscriptionsFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const removeSubscription = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/**
 * H4 (2026-08-26): when a send fails with a transient error (not 404/410),
 * record the error. If 5+ consecutive errors accumulate, prune the
 * subscription to avoid repeated futile pushes.
 */
const MAX_CONSECUTIVE_ERRORS = 5;
export const recordSubscriptionError = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.id);
    if (!sub) return;
    const next = (sub.consecutiveErrors ?? 0) + 1;
    if (next >= MAX_CONSECUTIVE_ERRORS) {
      await ctx.db.delete(args.id);
    } else {
      await ctx.db.patch(args.id, { consecutiveErrors: next, lastErrorAt: Date.now() });
    }
  },
});

export const resetSubscriptionErrors = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.id);
    if (!sub || !sub.consecutiveErrors) return;
    await ctx.db.patch(args.id, { consecutiveErrors: 0, lastErrorAt: undefined });
  },
});
