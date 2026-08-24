import { auth } from "./auth";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = MutationCtx | QueryCtx;

export async function currentUserId(ctx: Ctx): Promise<Id<"users">> {
  const userId = await auth.getUserId(ctx);
  if (!userId) throw new ConvexError("UNAUTHENTICATED");
  return userId;
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
