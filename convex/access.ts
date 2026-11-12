import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = MutationCtx | QueryCtx;

/**
 * Throwaway accounts provisioned by the automated QA suites.
 *
 * The e2e walkthrough and the review walkthrough create employees whose
 * addresses carry one of these prefixes. They are real rows in `public.users`,
 * so without this marker they would surface in a moderator's roster, count
 * toward workforce KPIs and receive broadcasts. A real login must never see
 * them.
 */
const QA_ACCOUNT_EMAIL_PREFIXES = ["e2e.", "review-emp."];

export function isQaAccount(user: Doc<"users">): boolean {
  const email = user.email ?? "";
  return QA_ACCOUNT_EMAIL_PREFIXES.some((prefix) => email.startsWith(prefix));
}

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

export async function requireManager(ctx: Ctx): Promise<Id<"users">> {
  const { userId, role } = await requireActiveUser(ctx);
  if (role !== "manager") throw new ConvexError("FORBIDDEN");
  return userId;
}

export async function requireEmployee(ctx: Ctx): Promise<Id<"users">> {
  const { userId, role } = await requireActiveUser(ctx);
  // Managers are field staff with a management title: they check in, log and
  // travel exactly like employees. Provisioning/payroll stay moderator-only.
  if (role !== "employee" && role !== "manager") throw new ConvexError("FORBIDDEN");
  return userId;
}

/**
 * Multi-tenant org boundary (audit 2026-11-11, P1-C1/C2 — the guards shipped
 * before this only checked when the *subject* had an orgId, so every moderator
 * provisioned without one (the default) silently bypassed cross-tenant protection).
 *
 * Both sides must agree: identical orgId, or BOTH absent (single-org install).
 * Exactly one side having an orgId, or two different orgIds → cross-tenant → refused.
 */
export function orgBoundaryOk(a: string | undefined | null, b: string | undefined | null): boolean {
  return (a ?? null) === (b ?? null);
}
