import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireModerator, requireActiveUser, requireManager, requireOrgScope, orgUsers, isQaAccount } from "./access";

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
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await requireOrgScope(ctx, args.orgId);
    const memberIds = new Set((await orgUsers(ctx, args.orgId, { includeInactive: true })).map((u) => u._id as string));
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
    const senders = new Map<string, { name: string; isQa: boolean }>();
    for (const m of merged) {
      if (!senders.has(m.senderId)) {
        const sender = await ctx.db.get(m.senderId);
        senders.set(m.senderId, {
          name: sender?.name ?? sender?.email ?? "unknown",
          isQa: sender ? isQaAccount(sender) : false,
        });
      }
    }
    // Throwaway QA accounts are never part of the real moderator queue.
    const filtered = merged.filter((m) => !senders.get(m.senderId)?.isQa && memberIds.has(m.senderId as string));
    return filtered.map((m) => ({
      _id: m._id,
      senderId: m.senderId,
      content: m.content,
      isRead: m.isRead,
      at: m._creationTime,
      senderName: senders.get(m.senderId)?.name ?? "unknown",
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
    if (!recipient || (recipient.role !== "employee" && recipient.role !== "manager") || !recipient.isActive || recipient.archivedAt !== undefined) {
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

/** Manager messaging (2026-11-10): a manager may 1:1 message ANY active,
 * non-QA user in their own organisation — not just crew at managed sites. */
export const managerOrgUsers = query({
  args: {},
  handler: async (ctx) => {
    const managerId = await requireManager(ctx);
    const me = await ctx.db.get(managerId);
    const orgId = me?.orgId;
    // Fail closed: a manager with no org sees nobody (never "everybody").
    if (orgId === undefined) return [];
    const users = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return users
      .filter((u) => {
        if (u._id === managerId) return false;
        if (!u.isActive || u.archivedAt !== undefined) return false;
        if (isQaAccount(u)) return false;
        return true;
      })
      .map((u) => ({ _id: u._id, name: u.name ?? u.email ?? "unknown", email: u.email, role: u.role }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  },
});

export const managerMessage = mutation({
  args: { recipientId: v.id("users"), content: v.string() },
  handler: async (ctx, args) => {
    const managerId = await requireManager(ctx);
    const text = validContent(args.content);
    const me = await ctx.db.get(managerId);
    const recipient = await ctx.db.get(args.recipientId);
    if (!recipient || !recipient.isActive || recipient.archivedAt !== undefined) {
      throw new ConvexError("INVALID_RECIPIENT");
    }
    if (me?.orgId === undefined || recipient.orgId !== me.orgId) {
      throw new ConvexError("NOT_IN_ORG");
    }
    if (isQaAccount(recipient)) {
      throw new ConvexError("INVALID_RECIPIENT");
    }
    await ctx.db.insert("messages", {
      senderId: managerId,
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

/** Manager broadcast: one message to every active, non-QA user in the manager's org. */
export const managerBroadcast = mutation({
  args: { content: v.string() },
  handler: async (ctx, args) => {
    const managerId = await requireManager(ctx);
    const text = validContent(args.content);
    const me = await ctx.db.get(managerId);
    const orgId = me?.orgId;
    if (orgId === undefined) throw new ConvexError("NOT_IN_ORG");
    const users = await ctx.db.query("users").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let sent = 0;
    for (const u of users) {
      if (u._id === managerId) continue;
      if (!u.isActive || u.archivedAt !== undefined) continue;
      if (isQaAccount(u)) continue;
      await ctx.db.insert("messages", {
        senderId: managerId,
        recipientId: u._id,
        modQueue: false,
        content: text,
        isRead: false,
      });
      sent += 1;
    }
    return { sent };
  },
});

export const broadcast = mutation({
  args: { orgId: v.id("organisations"), content: v.string() },
  handler: async (ctx, args) => {
    const moderatorId = await requireModerator(ctx);
    await requireOrgScope(ctx, args.orgId);
    const text = validContent(args.content);
    // Only the selected org's active, non-QA people (orgUsers filters all three).
    for (const e of await orgUsers(ctx, args.orgId)) {
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

    let archivedCount = 0;
    for (const m of batch) {
      const retentionDays = m.retentionDays ?? MSG_RETENTION_DEFAULT_DAYS;
      const ageMs = now - m._creationTime;
      if (ageMs > retentionDays * 86_400_000) {
        await ctx.db.patch(m._id, { archivedAt: now });
        archivedCount++;
      }
    }

    if (archivedCount > 0) {
      await ctx.db.insert("purgeAudit", {
        purgedAt: now,
        purgedCount: archivedCount,
        kind: "messages",
      });
    }

    if (batch.length === batchSize && archivedCount > 0) {
      await ctx.scheduler.runAfter(0, internal.messages.purgeExpiredMessages, {});
    }

    return archivedCount;
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
