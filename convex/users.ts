import { action, internalAction, internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  createAccount,
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { issueDeviceToken } from "./deviceTokens";
import { currentUserId, requireModerator } from "./access";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";


const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateIdCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `JP-${code}`;
}

async function requireModeratorActionCtx(ctx: import("./_generated/server").ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.runQuery(internal.users_queries.getById, { id: userId });
  if (!user || user.role !== "moderator" || !user.isActive || user.archivedAt !== undefined) {
    throw new ConvexError("FORBIDDEN");
  }
  return userId;
}

export const provisionEmployee = action({
  args: { name: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    await requireModeratorActionCtx(ctx);
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConvexError("INVALID_EMAIL");
    if (!args.name.trim() || args.name.trim().length > 100) throw new ConvexError("INVALID_NAME");
    const existing = await ctx.runQuery(internal.users_queries.getByEmail, {
      email,
    });
    if (existing) throw new ConvexError("USER_EXISTS");
    const idCode = generateIdCode();
    await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: idCode },
      profile: {
        name: args.name,
        email,
        role: "employee" as const,
        isActive: true,
      },
    });
    return { email, idCode };
  },
});

export const bootstrapFirstModerator = internalAction({
  args: { key: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    if (!process.env.BOOTSTRAP_KEY || args.key !== process.env.BOOTSTRAP_KEY) {
      throw new ConvexError("BOOTSTRAP_KEY_INVALID");
    }
    const moderators = await ctx.runQuery(internal.users_queries.listByRole, {
      role: "moderator",
    });
    if (moderators.length > 0) throw new ConvexError("MODERATOR_EXISTS");
    const idCode = generateIdCode();
    await createAccount(ctx, {
      provider: "password",
      account: { id: args.email.trim().toLowerCase(), secret: idCode },
      profile: {
        name: "Moderator",
        email: args.email.trim().toLowerCase(),
        role: "moderator" as const,
        isActive: true,
      },
    });
    return { email: args.email.trim().toLowerCase(), idCode };
  },
});

export const provisionModerator = action({
  args: { name: v.string(), email: v.string(), key: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const viaBreakGlass =
      args.key !== undefined &&
      process.env.BOOTSTRAP_KEY !== undefined &&
      args.key === process.env.BOOTSTRAP_KEY;
    if (!viaBreakGlass) {
      await requireModeratorActionCtx(ctx);
    }
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConvexError("INVALID_EMAIL");
    if (!args.name.trim() || args.name.trim().length > 100) throw new ConvexError("INVALID_NAME");
    const existing = await ctx.runQuery(internal.users_queries.getByEmail, { email });
    if (existing) throw new ConvexError("USER_EXISTS");
    const idCode = generateIdCode();
    await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: idCode },
      profile: {
        name: args.name,
        email,
        role: "moderator" as const,
        isActive: true,
      },
    });
    return { email, idCode };
  },
});

export const archiveUserBreakGlass = internalAction({
  args: { key: v.string(), email: v.string() },
  handler: async (ctx, args): Promise<{ archived: string }> => {
    if (!process.env.BOOTSTRAP_KEY || args.key !== process.env.BOOTSTRAP_KEY) {
      throw new ConvexError("BOOTSTRAP_KEY_INVALID");
    }
    const user: { _id: Id<"users">; email?: string | null } | null = await ctx.runQuery(
      internal.users_queries.getByEmail,
      { email: args.email.trim().toLowerCase() }
    );
    if (!user) throw new ConvexError("USER_NOT_FOUND");
    await ctx.runMutation(internal.users.archiveUserInternal, { userId: user._id });
    return { archived: user.email ?? "" };
  },
});

export const archiveUserInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { archivedAt: Date.now(), isActive: false });
  },
});

export const changeMyPassword = action({
  args: { currentSecret: v.string(), newSecret: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("UNAUTHENTICATED");
    const user = await ctx.runQuery(internal.users_queries.getById, { id: userId });
    if (!user?.email) throw new ConvexError("NO_EMAIL_ON_ACCOUNT");
    if (args.newSecret.length < 8 || args.newSecret.length > 200) {
      throw new ConvexError("INVALID_PASSWORD_LENGTH");
    }
    await retrieveAccount(ctx, {
      provider: "password",
      account: { id: user.email, secret: args.currentSecret },
    });
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: user.email, secret: args.newSecret },
    });
    return { ok: true as const };
  },
});

export const deactivateEmployee = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || user.role !== "employee") throw new ConvexError("NOT_AN_EMPLOYEE");
    await ctx.db.patch(args.userId, { archivedAt: Date.now() });
  },
});

export const resetDeviceToken = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await ctx.db.patch(args.userId, { deviceId: undefined });
  },
});

export const issueMyDeviceToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user || user.archivedAt !== undefined || !user.isActive) {
      throw new ConvexError("INACTIVE_ACCOUNT");
    }
    if (user.deviceId !== undefined) {
      throw new ConvexError("DEVICE_ALREADY_ACTIVE");
    }
    const secret = process.env.DEVICE_TOKEN_SECRET;
    if (!secret) throw new ConvexError("DEVICE_TOKEN_SECRET_NOT_SET");
    const { token, issuedAt } = await issueDeviceToken(userId, secret);
    await ctx.db.patch(userId, { deviceId: String(issuedAt) });
    return token;
  },
});
