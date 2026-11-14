import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { maybeCurrentUserId, isQaAccount } from "./access";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await maybeCurrentUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || !user.isActive || user.archivedAt !== undefined) return null;
    return user;
  },
});

export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    const viewerId = await maybeCurrentUserId(ctx);
    // Security/Zero-Trust: only a moderator may enumerate the workforce.
    if (!viewerId) {
      return [];
    }
    const viewer = await ctx.db.get(viewerId);
    if (viewer?.role !== "moderator") {
      return [];
    }

    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .filter((q) => q.and(q.eq(q.field("isActive"), true), q.eq(q.field("archivedAt"), undefined)))
      .collect();
    const managerRows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "manager"))
      .filter((q) => q.and(q.eq(q.field("isActive"), true), q.eq(q.field("archivedAt"), undefined)))
      .collect();
    rows.push(...managerRows);

    // Throwaway QA accounts are real rows in `users` — never surface them.
    return rows
      .filter((u) => !isQaAccount(u))
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
      }));
  },
});

export const getById = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .collect();
    // Master-temp moderators reuse the operator's email for audit. They must
    // never shadow the real account: `.first()` here could return the temp
    // row and make password resets / provisioning target the wrong identity.
    return matches.find((u) => u.isMasterTemp !== true) ?? null;
  },
});

export const listByRole = internalQuery({
  args: { role: v.union(v.literal("moderator"), v.literal("employee")) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .collect();
  },
});

export const listModerators = query({
  args: {},
  handler: async (ctx) => {
    const viewerId = await maybeCurrentUserId(ctx);
    if (!viewerId) return [];
    const viewer = await ctx.db.get(viewerId);
    if (!viewer || viewer.role !== "moderator" || !viewer.isActive || viewer.archivedAt !== undefined) {
      return [];
    }

    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "moderator"))
      .collect();

    return rows
      .filter((u) => !isQaAccount(u) && u.isMasterTemp !== true)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        archivedAt: u.archivedAt,
        hasChangedPassword: u.passwordChangedAt !== undefined,
      }))
      .sort((a, b) =>
        String(a.name ?? a.email ?? "").localeCompare(String(b.name ?? b.email ?? ""))
      );
  },
});
