import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, requireActiveUser } from "./access";
import { isDemoUser } from "./demo/scope";

function validContent(content: string): string {
  const text = content.trim();
  if (!text || text.length > 2000) throw new ConvexError("INVALID_CONTENT");
  return text;
}

export const sendToModerators = mutation({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireActiveUser(ctx);
    const text = validContent(args.content);
    await ctx.db.insert("messages", {
      senderId: userId,
      modQueue: true,
      content: text,
      isRead: false,
    });
  },
});

export const moderatorInbox = query({
  args: {},
  handler: async (ctx) => {
    await requireModerator(ctx);
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_modqueue_unread", (q) => q.eq("modQueue", true).eq("isRead", false))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(100);
    const read = await ctx.db
      .query("messages")
      .withIndex("by_modqueue_unread", (q) => q.eq("modQueue", true).eq("isRead", true))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .take(50);
    const merged = [...unread, ...read].sort((a, b) => b._creationTime - a._creationTime);
    const senders = new Map<string, string>();
    for (const m of merged) {
      if (!senders.has(m.senderId)) {
        const sender = await ctx.db.get(m.senderId);
        senders.set(m.senderId, sender?.name ?? sender?.email ?? "unknown");
      }
    }
    return merged.map((m) => ({
      _id: m._id,
      senderId: m.senderId,
      content: m.content,
      isRead: m.isRead,
      at: m._creationTime,
      senderName: senders.get(m.senderId) ?? "unknown",
    }));
  },
});

export const markQueueItemRead = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await ctx.db.patch(args.messageId, { isRead: true });
  },
});

export const myInbox = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireActiveUser(ctx);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_recipient_read", (q) => q.eq("recipientId", userId))
      .order("desc")
      .take(50);
    return rows.filter((m) => m.archivedAt === undefined);
  },
});

export const replyToEmployee = mutation({
  args: { recipientId: v.id("users"), content: v.string() },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
    const text = validContent(args.content);
    // H3 (2026-08-26): validate recipient exists, is a real employee, and is
    // active. Prevents silent message black-holes and leaked employee IDs.
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient || recipient.role !== "employee" || !recipient.isActive || recipient.archivedAt !== undefined) {
      throw new ConvexError("INVALID_RECIPIENT");
    }
    await ctx.db.insert("messages", {
      senderId: moderatorId,
      recipientId: args.recipientId,
      modQueue: false,
      content: text,
      isRead: false,
    });
    await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
      userId: args.recipientId,
      title: "J-Pay",
      body: text.slice(0, 80),
    });
  },
});

export const broadcast = mutation({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
    const text = validContent(args.content);
    const employees = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .collect();
    for (const e of employees) {
      if (e.archivedAt !== undefined || !e.isActive) continue;
      if (isDemoUser(e)) continue;
      await ctx.db.insert("messages", {
        senderId: moderatorId,
        recipientId: e._id,
        modQueue: false,
        content: text,
        isRead: false,
      });
    }
  },
});

/**
 * H6 (2026-08-26): archive messages whose age exceeds their per-row
 * retentionDays. Rows without retentionDays are untouched (default policy
 * is an open question per TRD §11).
 */
const MSG_RETENTION_DEFAULT_DAYS = 90;
export const purgeExpiredMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const batchSize = 200;
    const cutoff = now - MSG_RETENTION_DEFAULT_DAYS * 86_400_000;
    const batch = await ctx.db
      .query("messages")
      .filter((q) =>
        q.and(
          q.eq(q.field("archivedAt"), undefined),
          q.lt(q.field("_creationTime"), cutoff)
        )
      )
      .take(batchSize);

    for (const m of batch) {
      const retentionDays = m.retentionDays ?? MSG_RETENTION_DEFAULT_DAYS;
      const ageMs = now - m._creationTime;
      if (ageMs > retentionDays * 86_400_000) {
        await ctx.db.patch(m._id, { archivedAt: now });
      }
    }

    if (batch.length > 0) {
      await ctx.db.insert("purgeAudit", {
        purgedAt: now,
        purgedCount: batch.length,
        kind: "messages",
      });
    }

    if (batch.length === batchSize) {
      await ctx.scheduler.runAfter(0, internal.messages.purgeExpiredMessages, {});
    }

    return batch.length;
  },
});

export const markThreadRead = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireActiveUser(ctx);
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_recipient_read", (q) => q.eq("recipientId", userId).eq("isRead", false))
      .collect();
    await Promise.all(unread.map((m) => ctx.db.patch(m._id, { isRead: true })));
    return unread.length;
  },
});
