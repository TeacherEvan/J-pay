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
