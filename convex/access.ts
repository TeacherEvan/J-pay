import { auth } from "./auth";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isDemoUser } from "./demo/scope";

type Ctx = MutationCtx | QueryCtx;

export async function currentUserId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await auth.getUserId(ctx);
  if (!userId) throw new ConvexError("UNAUTHENTICATED");
  return userId;
}

export async function maybeCurrentUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  return await auth.getUserId(ctx);
}

export async function requireActiveUser(
  ctx: Ctx
): Promise<{ userId: Id<"users">; role: "moderator" | "employee" }> {
  const userId = await currentUserId(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.archivedAt !== undefined || !user.isActive) {
    throw new ConvexError("INACTIVE_ACCOUNT");
  }
  return { userId, role: user.role };
}

export async function requireModerator(ctx: Ctx): Promise<Id<"users">> {
  const { userId, role } = await requireActiveUser(ctx);
  if (role !== "moderator") throw new ConvexError("FORBIDDEN");
  return userId;
}

export async function requireEmployee(ctx: Ctx): Promise<Id<"users">> {
  const { userId, role } = await requireActiveUser(ctx);
  if (role !== "employee") throw new ConvexError("FORBIDDEN");
  return userId;
}

export async function requireDemoReviewer(
  ctx: Ctx
): Promise<{ userId: Id<"users">; personaUserId: Id<"users">; personaEmail: string }> {
  if (process.env.DEMO_MODE !== "1") throw new ConvexError("FORBIDDEN");
  const userId = await currentUserId(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.isAnonymous !== true || !user.isActive || user.archivedAt !== undefined) {
    throw new ConvexError("FORBIDDEN");
  }
  const session = await ctx.db
    .query("demoSessions")
    .withIndex("by_reviewer", (q) => q.eq("reviewerId", userId))
    .first();
  if (!session) throw new ConvexError("DEMO_SESSION_NOT_BOUND");
  const persona = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", session.personaEmail))
    .first();
  // SECURITY (2026-09-01): require the bound persona to be a demo-tagged user.
  // Previously only "persona exists, is employee, is not anonymous" was checked,
  // which let demo reviewers bind to real employees and write attendance against
  // them with isModeratorOverride: true. See red-team audit F1+F2.
  if (!persona || persona.role !== "employee" || !isDemoUser(persona) || persona.archivedAt !== undefined || !persona.isActive) {
    throw new ConvexError("PERSONA_NOT_FOUND");
  }
  return { userId, personaUserId: persona._id, personaEmail: session.personaEmail };
}
