import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isDemoUser } from "./demo/scope";

type Ctx = MutationCtx | QueryCtx;

/**
 * Identity lookup.
 *
 * NOTE (2026-10-28, Supabase cutover): this used to call `auth.getUserId(ctx)`
 * from ./auth, which pulled the whole convexAuth() provider graph (and its JWT
 * env requirements) into every module's import chain. `getAuthUserId` is the
 * same lookup at the bottom of that stack — it reads
 * `ctx.auth.getUserIdentity().subject` — and works unchanged against the
 * Supabase-backed runtime in src/lib/backend.
 */
export async function currentUserId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("UNAUTHENTICATED");
  return userId as Id<"users">;
}

export async function maybeCurrentUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  return userId ? (userId as Id<"users">) : null;
}

export async function requireActiveUser(
  ctx: Ctx
): Promise<{ userId: Id<"users">; role: "moderator" | "employee" | "manager" }> {
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
  // Managers are field staff with a management title: they check in, log and
  // travel exactly like employees. Provisioning/payroll stay moderator-only.
  if (role !== "employee" && role !== "manager") throw new ConvexError("FORBIDDEN");
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
