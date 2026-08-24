import { action, internalAction, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { issueDeviceToken } from "./deviceTokens";
import { currentUserId } from "./access";
import { api } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateIdCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `JP-${code}`;
}

async function requireModeratorActionCtx(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.runQuery(api.users_queries.getById, { id: userId });
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
    const existing = await ctx.runQuery(api.users_queries.getByEmail, {
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
    const moderators = await ctx.runQuery(api.users_queries.listByRole, {
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

export const issueMyDeviceToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user || user.archivedAt !== undefined || !user.isActive) {
      throw new ConvexError("INACTIVE_ACCOUNT");
    }
    const secret = process.env.DEVICE_TOKEN_SECRET;
    if (!secret) throw new ConvexError("DEVICE_TOKEN_SECRET_NOT_SET");
    const { token, issuedAt } = issueDeviceToken(userId, secret);
    await ctx.db.patch(userId, { deviceId: String(issuedAt) });
    return token;
  },
});
