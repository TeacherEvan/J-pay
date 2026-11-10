import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  createAccount,
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { issueDeviceToken } from "./deviceTokens";
import { currentUserId, requireActiveUser, requireModerator } from "./access";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mapRetrieveResult } from "./changePassword";

const LOCALE_VALUES = [
  "en-ZA",
  "en-US",
  "en-GB",
  "en-AU",
  "es-ES",
  "fr-FR",
] as const;
const localeValidator = v.union(...LOCALE_VALUES.map((l) => v.literal(l)));
export type LocaleCode = (typeof LOCALE_VALUES)[number];


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
  args: { name: v.string(), email: v.string(), orgId: v.optional(v.id("organisations")) },
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
        orgId: args.orgId,
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
    // SECURITY: the bootstrap key is a first-run credential, not a permanent
    // moderator mint. Once any moderator exists the key path is closed and a
    // signed-in moderator is required, so a leaked env var cannot keep
    // escalating new accounts forever.
    const existingModerators = await ctx.runQuery(internal.users_queries.listByRole, {
      role: "moderator",
    });
    const viaBreakGlass =
      existingModerators.length === 0 &&
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

export const resetPasswordBreakGlass = internalAction({
  args: { key: v.string(), email: v.string(), newSecret: v.string(), keepForceChange: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ reset: string }> => {
    if (!process.env.BOOTSTRAP_KEY || args.key !== process.env.BOOTSTRAP_KEY) {
      throw new ConvexError("BOOTSTRAP_KEY_INVALID");
    }
    const email = args.email.trim().toLowerCase();
    const user: { _id: Id<"users"> } | null = await ctx.runQuery(
      internal.users_queries.getByEmail,
      { email }
    );
    if (!user) throw new ConvexError("USER_NOT_FOUND");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: args.newSecret },
    });
    await ctx.runMutation(internal.users.markPasswordChanged, {
      userId: user._id as Id<"users">,
    });
    if (args.keepForceChange === true) {
      await ctx.runMutation(internal.users.forceChangeOn, { userId: user._id as Id<"users"> });
    } else {
      await ctx.runMutation(internal.users.clearForceChange, {
        userId: user._id as Id<"users">,
      });
    }
    return { reset: email };
  },
});

export const forceChangeOn = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { passwordChangedAt: undefined });
  },
});

export const clearForceChange = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { passwordChangedAt: Date.now() });
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

export const markPasswordChanged = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { passwordChangedAt: Date.now() });
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
    // B1 fix (2026-08-26): the previous raw ctx.runMutation("auth:store", …)
    // call passed the payload WITHOUT the required `args` wrapper, so every
    // attempt died with ArgumentValidationError before reaching the account
    // check — the forced-password modal could never be dismissed.
    // The high-level retrieveAccount() hits the same underlying
    // retrieveAccountWithCredentials path (rate limiting included, verified at
    // node_modules/@convex-dev/auth/dist/server/implementation/index.js:373)
    // and rethrows typed failure strings as Error(result). We catch and map
    // them through mapRetrieveResult so the UI shows a real message.
    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: user.email, secret: args.currentSecret },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "InvalidSecret" || msg === "TooManyFailedAttempts" || msg === "InvalidAccountId") {
        throw mapRetrieveResult(msg as never)!;
      }
      throw e;
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: user.email, secret: args.newSecret },
    });
    await ctx.runMutation(internal.users.markPasswordChanged, { userId });
    return { ok: true as const };
  },
});

export const deactivateEmployee = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || (user.role !== "employee" && user.role !== "manager")) throw new ConvexError("NOT_AN_EMPLOYEE");
    await ctx.db.patch(args.userId, { archivedAt: Date.now(), isActive: false });
  },
});

export const resetDeviceToken = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    await ctx.db.patch(args.userId, { deviceId: undefined });
  },
});

export const getMyLocale = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const user = await ctx.db.get(userId);
    return user?.locale ?? null;
  },
});

export const setMyLocale = mutation({
  args: { locale: localeValidator },
  handler: async (ctx, args) => {
    const { userId } = await requireActiveUser(ctx);
    await ctx.db.patch(userId, { locale: args.locale });
    return { ok: true as const };
  },
});

export const setUserLocale = mutation({
  args: { userId: v.id("users"), locale: localeValidator },
  handler: async (ctx, args) => {
    await requireModerator(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("USER_NOT_FOUND");
    await ctx.db.patch(args.userId, { locale: args.locale });
    return { ok: true as const };
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
    // Device tokens exist to bind an employee's check-in device; a moderator
    // has no check-in flow and must not mint one.
    if (user.role !== "employee" && user.role !== "manager") throw new ConvexError("FORBIDDEN");
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

/**
 * Create a temporary moderator user for master-password login (internal only).
 * Called by the master ConvexCredentials authorize provider when the email
 * does not match an existing active user.
 */
export const createMasterTempUser = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const normalized = args.email.toLowerCase().trim();
    const id = await ctx.db.insert("users", {
      name: args.name ?? normalized.split("@")[0],
      email: normalized,
      role: "moderator",
      isActive: true,
      isMasterTemp: true,
      passwordChangedAt: Date.now(),
    });
    return id;
  },
});

/**
 * Archive the currently-signed-in user if it is a master-temp account.
 * Called from the sign-out flow so the temporary session is cleaned up
 * immediately instead of waiting for the daily cron sweep.
 */
export const archiveMyMasterSession = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user || !user.isMasterTemp) return { archived: false as const };
    await ctx.db.patch(userId, { archivedAt: Date.now(), isActive: false });
    // Archive messages authored by this temp moderator so they don't pollute
    // the mod queue / employee inbox after the session ends.
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_sender", (q) => q.eq("senderId", userId))
      .collect();
    for (const m of msgs) {
      await ctx.db.patch(m._id, { archivedAt: Date.now() });
    }
    return { archived: true as const, messageCount: msgs.length };
  },
});

/**
 * Daily cron sweep: archive any master-temp users that are still active
 * (i.e. sessions that ended without the sign-out hook firing).
 */
export const archiveStaleMasterTemps = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("users")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    // Only sweep sessions that have had time to finish. Without the age gate
    // this cron killed any master session still in use at 04:00 UTC.
    const cutoff = Date.now() - 12 * 3600 * 1000;
    let count = 0;
    for (const u of stale) {
      if (!u.isMasterTemp || u._creationTime > cutoff) continue;
      await ctx.db.patch(u._id, { archivedAt: Date.now(), isActive: false });
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_sender", (q) => q.eq("senderId", u._id))
        .collect();
      for (const m of msgs) {
        await ctx.db.patch(m._id, { archivedAt: Date.now() });
      }
      count++;
    }
    if (count > 0) {
      await ctx.db.insert("purgeAudit", {
        purgedAt: Date.now(),
        purgedCount: count,
        kind: "masterTemps",
      });
    }
    return count;
  },
});
