import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { maybeCurrentUserId } from "./access";
import { isDemoUser } from "./demo/scope";

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
    const isDemo = process.env.DEMO_MODE === "1";
    // Security/Zero-Trust: Anonymous callers cannot enumerate employees in production.
    if (!viewerId && !isDemo) {
      return [];
    }

    const viewer = viewerId ? await ctx.db.get(viewerId) : null;
    const isModerator = viewer?.role === "moderator";

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

    return rows
      .filter((u) => {
        // Unauthenticated or non-moderator caller: in demo mode, only surface demo personas
        if (!isModerator) {
          return isDemo && isDemoUser(u);
        }
        // Moderator viewer: in production, hide demo personas; in demo mode, show all
        return isDemo ? true : !isDemoUser(u);
      })
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
