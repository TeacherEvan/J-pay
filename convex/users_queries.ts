import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { maybeCurrentUserId } from "./access";

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
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "employee"))
      .filter((q) => q.and(q.eq(q.field("isActive"), true), q.eq(q.field("archivedAt"), undefined)))
      .collect();
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
