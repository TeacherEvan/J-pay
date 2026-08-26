"use node";

import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

function configure(): boolean {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export const pushToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    if (!configure()) return;
    const subs = await ctx.runQuery(internal.push_subs.subscriptionsFor, {
      userId: args.userId,
    });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth } },
          JSON.stringify({ title: args.title, body: args.body })
        );
        // H4 (2026-08-26): reset consecutive error counter on success.
        await ctx.runMutation(internal.push_subs.resetSubscriptionErrors, { id: sub._id });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await ctx.runMutation(internal.push_subs.removeSubscription, { id: sub._id });
        } else {
          // H4: transient failure — record; prunes after MAX_CONSECUTIVE_ERRORS.
          await ctx.runMutation(internal.push_subs.recordSubscriptionError, { id: sub._id });
        }
      }
    }
  },
});
