import "server-only";

import { createClient } from "@supabase/supabase-js";
import { ConvexError } from "convex/values";

import { Database, type Doc } from "./db";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseAdminClient, hasSupabaseAdminKey } from "@/lib/supabase/admin";

import * as users from "../../../convex/users";
import * as usersQueries from "../../../convex/users_queries";
import * as sites from "../../../convex/sites";
import * as organisations from "../../../convex/organisations";
import * as punches from "../../../convex/punches";
import * as logs from "../../../convex/logs";
import * as shifts from "../../../convex/shifts";
import * as messages from "../../../convex/messages";
import * as moderator from "../../../convex/moderator";
import * as manager from "../../../convex/manager";
import * as travel from "../../../convex/travel";
import * as payroll from "../../../convex/payroll";
import * as payrollData from "../../../convex/payroll_data";
import * as kpi from "../../../convex/kpi";
import * as push from "../../../convex/push";
import * as pushSubs from "../../../convex/push_subs";
import * as deviceTokens from "../../../convex/deviceTokens";
import * as geocode from "../../../convex/geocode";
import * as demo from "../../../convex/demo";
import * as demoIndex from "../../../convex/demo/index";

/**
 * Supabase-backed runtime for the Convex-shaped business logic in convex/*.ts.
 *
 * "Supabase is the boss" means: Postgres holds the data, Supabase Auth holds
 * the identities, and this module is the only path between the two and the
 * browser. The Convex function bodies are reused verbatim — only their
 * execution context changes (`ctx.db`, `ctx.auth`, `ctx.scheduler`).
 */

export type Identity = {
  subject: string;
  email?: string;
  name?: string;
};

type Handler = {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

type Registry = Map<string, Handler>;

const FUNCTION_NAME = Symbol.for("functionName");

/* --------------------------------------------------------------- registry -- */

const MODULES: Record<string, unknown> = {
  users,
  users_queries: usersQueries,
  sites,
  organisations,
  punches,
  logs,
  shifts,
  messages,
  moderator,
  manager,
  travel,
  payroll,
  payroll_data: payrollData,
  kpi,
  push,
  push_subs: pushSubs,
  deviceTokens,
  geocode,
  demo,
  "demo/index": demoIndex,
};

function isHandler(value: unknown): value is Handler {
  // Convex's registered functions are plain objects in Node but *callable*
  // objects (functions carrying the metadata) in the bundled server runtime.
  if (typeof value !== "object" && typeof value !== "function") return false;
  if (value === null) return false;
  return typeof (value as Handler)._handler === "function";
}

function buildRegistry(): Registry {
  const registry: Registry = new Map();
  for (const [moduleName, exports] of Object.entries(MODULES)) {
    for (const [exportName, value] of Object.entries(exports as Record<string, unknown>)) {
      if (isHandler(value)) registry.set(`${moduleName}:${exportName}`, value);
    }
  }
  return registry;
}

let cachedRegistry: Registry | null = null;

function registry(): Registry {
  if (!cachedRegistry) cachedRegistry = buildRegistry();
  return cachedRegistry;
}

/** Turn either a client `{module, fn}` ref or an `anyApi` proxy into a key. */
export function refToKey(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") {
    const symbol = (ref as Record<symbol, unknown>)[FUNCTION_NAME];
    if (typeof symbol === "string") return symbol;
    const maybe = ref as { module?: string; fn?: string };
    if (maybe.module && maybe.fn) return `${maybe.module}:${maybe.fn}`;
  }
  throw new ConvexError("UNKNOWN_FUNCTION");
}

/* -------------------------------------------------------------------- ctx -- */

const SCHEDULED_MAX_ATTEMPTS = 2;
const SCHEDULED_RETRY_DELAY_MS = 150;

/**
 * Run a scheduled job with bounded retries. Scheduled work (shift derivation
 * after a punch) decides what pays; it must not vanish into a console line.
 * Returns `{ok, value|error}` — never throws. Exported for tests.
 */
export async function withScheduledRetry<T>(
  fn: () => Promise<T>,
  attempts: number = SCHEDULED_MAX_ATTEMPTS
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, SCHEDULED_RETRY_DELAY_MS));
      }
    }
  }
  return { ok: false, error: lastError };
}

/** Structured failure line the host can alert on. Never throws. */
function reportScheduledFailure(ref: unknown, args: Record<string, unknown>, error: unknown, attempts: number): void {
  let key = "unknown";
  try { key = refToKey(ref); } catch { /* keep unknown */ }
  console.error(JSON.stringify({
    event: "scheduled_job_failed",
    ref: key,
    userId: typeof args?.userId === "string" ? args.userId : undefined,
    attempts,
    message: error instanceof Error ? error.message : String(error),
  }));
}

/**
 * C1 (2026-11-10): a scheduled deriveForUser that exhausts retries must not
 * die as a console line. Stamp unsealed shifts needsReview=derivation_failed
 * and write a systemEvents row, both best-effort (never throws).
 */
async function noteDeriveFailure(
  ctx: RequestContext,
  ref: unknown,
  args: Record<string, unknown>,
  error: unknown
): Promise<void> {
  try {
    const userId = typeof args?.userId === "string" ? args.userId : undefined;
    let key = "";
    try { key = refToKey(ref); } catch { return; }
    if (key !== "shifts:deriveForUser" || !userId) return;
    const detail = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
    await ctx.scheduler.runAfter(0, "shifts:markDerivationFailed", { userId, detail });
  } catch (e) {
    console.error("[derivation-failed] best-effort marker failed", e);
  }
}

class RequestContext {
  db = new Database();

  constructor(private identity: Identity | null) {}

  auth = {
    getUserIdentity: async (): Promise<Record<string, unknown> | null> => {
      if (!this.identity) return null;
      return {
        subject: this.identity.subject,
        email: this.identity.email,
        name: this.identity.name,
        tokenIdentifier: `supabase|${this.identity.subject}`,
      };
    },
  };

  runQuery = async (ref: unknown, args: Record<string, unknown>) =>
    invoke(ref, args, this.identity, true);

  runMutation = async (ref: unknown, args: Record<string, unknown>) =>
    invoke(ref, args, this.identity, true);

  runAction = async (ref: unknown, args: Record<string, unknown>) =>
    invoke(ref, args, this.identity, true);

  /**
   * Convex `runAfter(0, …)` fires after the mutation returns. We run inline
   * (Postgres has no transaction wrapping these handlers), but a failed job
   * now gets bounded retries and, on final failure, a structured
   * `scheduled_job_failed` line the host can alert on — it previously vanished
   * into console.error (audit 2026-11-10, P1-3). The job itself is not made
   * transactional here; failures still do not roll back the punch.
   */
  scheduler = {
    runAfter: async (
      _delayMs: number,
      ref: unknown,
      args: Record<string, unknown> = {}
    ): Promise<void> => {
      const outcome = await withScheduledRetry(() => invoke(ref, args, this.identity, true));
      if (!outcome.ok) {
        reportScheduledFailure(ref, args, outcome.error, SCHEDULED_MAX_ATTEMPTS);
        await noteDeriveFailure(this, ref, args, outcome.error);
      }
    },
    runAt: async (
      _when: number,
      ref: unknown,
      args: Record<string, unknown> = {}
    ): Promise<void> => {
      const outcome = await withScheduledRetry(() => invoke(ref, args, this.identity, true));
      if (!outcome.ok) reportScheduledFailure(ref, args, outcome.error, SCHEDULED_MAX_ATTEMPTS);
    },
    cancel: async (): Promise<void> => {},
  };
}

/* -------------------------------------------------------------- overrides -- */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateIdCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `JP-${code}`;
}

function requireAdminKey(): void {
  if (!hasSupabaseAdminKey()) {
    throw new ConvexError("BOOTSTRAP_KEY_INVALID");
  }
}

async function requireModeratorActionCtx(ctx: RequestContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db.get<Doc>(String(identity.subject));
  if (!user || user.role !== "moderator" || !user.isActive || user.archivedAt !== undefined) {
    throw new ConvexError("FORBIDDEN");
  }
  return String(identity.subject);
}

function normaliseEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConvexError("INVALID_EMAIL");
  return email;
}

function normaliseName(raw: unknown): string {
  const name = String(raw ?? "").trim();
  if (!name || name.length > 100) throw new ConvexError("INVALID_NAME");
  return name;
}

/**
 * Creates the Supabase Auth identity and the matching public.users row.
 * The ID code is the initial password; `passwordChangedAt` stays unset so the
 * app forces a change on first sign-in (same contract as before).
 */
async function createAccount(
  ctx: RequestContext,
  args: { name: string; email: string; role: "moderator" | "employee"; orgId?: string }
): Promise<string> {
  requireAdminKey();
  const admin = createSupabaseAdminClient();
  const idCode = generateIdCode();
  const { data, error } = await admin.auth.admin.createUser({
    email: args.email,
    password: idCode,
    email_confirm: true,
    user_metadata: { name: args.name, role: args.role },
  });
  if (error || !data.user) {
    const message = error?.message ?? "create user failed";
    if (/already|exists|registered/i.test(message)) throw new ConvexError("USER_EXISTS");
    throw new ConvexError("PROVISION_FAILED");
  }
  await ctx.db.insert("users", {
    _id: data.user.id,
    name: args.name,
    email: args.email,
    role: args.role,
    isActive: true,
    orgId: args.orgId,
  });
  return idCode;
}

/** Overrides that replace internal* Convex functions — server callers only. */
const INTERNAL_ONLY_OVERRIDES = new Set([
  "users:bootstrapFirstModerator",
  "users:resetPasswordBreakGlass",
  "users:createMasterTempUser",
]);

const OVERRIDES: Record<string, Handler["_handler"]> = {
  /* --- account provisioning (Supabase Auth owns credentials now) --------- */
  "users:provisionEmployee": async (ctx, args) => {
    const request = ctx as RequestContext;
    await requireModeratorActionCtx(request);
    const email = normaliseEmail(args.email);
    const name = normaliseName(args.name);
    if (args.orgId !== undefined) {
      const org = await request.db.get(String(args.orgId));
      if (!org || org.archivedAt !== undefined) throw new ConvexError("ORG_NOT_FOUND");
    }
    const existing = await request.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existing) throw new ConvexError("USER_EXISTS");
    const idCode = await createAccount(request, { name, email, role: "employee", orgId: args.orgId ? String(args.orgId) : undefined });
    return { email, idCode };
  },

  "users:provisionModerator": async (ctx, args) => {
    const request = ctx as RequestContext;
    const existingModerators = await request.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "moderator"))
      .collect();
    const viaBreakGlass =
      existingModerators.length === 0 &&
      args.key !== undefined &&
      process.env.BOOTSTRAP_KEY !== undefined &&
      args.key === process.env.BOOTSTRAP_KEY;
    if (!viaBreakGlass) await requireModeratorActionCtx(request);
    const email = normaliseEmail(args.email);
    const name = normaliseName(args.name);
    const existing = await request.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existing) throw new ConvexError("USER_EXISTS");
    const idCode = await createAccount(request, { name, email, role: "moderator" });
    return { email, idCode };
  },

  "users:bootstrapFirstModerator": async (ctx, args) => {
    const request = ctx as RequestContext;
    if (!process.env.BOOTSTRAP_KEY || args.key !== process.env.BOOTSTRAP_KEY) {
      throw new ConvexError("BOOTSTRAP_KEY_INVALID");
    }
    const moderators = await request.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "moderator"))
      .collect();
    if (moderators.length > 0) throw new ConvexError("MODERATOR_EXISTS");
    const email = normaliseEmail(args.email);
    const idCode = await createAccount(request, { name: "Moderator", email, role: "moderator" });
    return { email, idCode };
  },

  "users:resetPasswordBreakGlass": async (ctx, args) => {
    const request = ctx as RequestContext;
    if (!process.env.BOOTSTRAP_KEY || args.key !== process.env.BOOTSTRAP_KEY) {
      throw new ConvexError("BOOTSTRAP_KEY_INVALID");
    }
    const email = normaliseEmail(args.email);
    const user = await request.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) throw new ConvexError("USER_NOT_FOUND");
    const newSecret = String(args.newSecret ?? "");
    if (newSecret.length < 8 || newSecret.length > 200) {
      throw new ConvexError("INVALID_PASSWORD_LENGTH");
    }
    requireAdminKey();
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(String(user._id), {
      password: newSecret,
    });
    if (error) throw new ConvexError("PASSWORD_RESET_FAILED");
    if (args.keepForceChange === true) {
      await request.db.patch(String(user._id), { passwordChangedAt: undefined });
    } else {
      await request.db.patch(String(user._id), { passwordChangedAt: Date.now() });
    }
    return { reset: email };
  },

  "users:changeMyPassword": async (ctx, args) => {
    const request = ctx as RequestContext;
    const identity = await request.auth.getUserIdentity();
    if (!identity) throw new ConvexError("UNAUTHENTICATED");
    const user = await request.db.get<Doc>(String(identity.subject));
    if (!user?.email) throw new ConvexError("NO_EMAIL_ON_ACCOUNT");
    const newSecret = String(args.newSecret ?? "");
    if (newSecret.length < 8 || newSecret.length > 200) {
      throw new ConvexError("INVALID_PASSWORD_LENGTH");
    }
    // Verify the current credential by actually signing in with a throwaway
    // client — Supabase never exposes password hashes to compare against.
    const { url, key } = readSupabaseEnv();
    const probe = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: signInError } = await probe.auth.signInWithPassword({
      email: String(user.email),
      password: String(args.currentSecret ?? ""),
    });
    await probe.auth.signOut().catch(() => {});
    if (signInError) {
      const message = signInError.message.toLowerCase();
      if (message.includes("rate") || message.includes("too many")) {
        throw new ConvexError("TOO_MANY_ATTEMPTS");
      }
      throw new ConvexError("INVALID_CURRENT_PASSWORD");
    }
    requireAdminKey();
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(String(user._id), {
      password: newSecret,
    });
    if (error) throw new ConvexError("PASSWORD_CHANGE_FAILED");
    await request.db.patch(String(user._id), { passwordChangedAt: Date.now() });
    return { ok: true as const };
  },

  "users:createMasterTempUser": async (ctx, args) => {
    const request = ctx as RequestContext;
    const email = String(args.email ?? "").toLowerCase().trim();
    return await request.db.insert("users", {
      name: String(args.name ?? email.split("@")[0]),
      email,
      role: "moderator",
      isActive: true,
      isMasterTemp: true,
      passwordChangedAt: Date.now(),
    });
  },
};

/* ----------------------------------------------------------------- invoke -- */

export async function invoke(
  ref: unknown,
  args: Record<string, unknown> = {},
  identity: Identity | null = null,
  /**
   * false = called from the browser: internalQuery/internalMutation/
   * internalAction and internal-only overrides are refused, mirroring Convex's
   * public/internal split. true = called by another backend function or the
   * scheduler.
   */
  fromServer = false
): Promise<unknown> {
  const key = refToKey(ref);
  const override = OVERRIDES[key];
  if (override) {
    if (!fromServer && INTERNAL_ONLY_OVERRIDES.has(key)) {
      throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
    }
    return await override(new RequestContext(identity) as unknown as never, args ?? {});
  }
  const handler = registry().get(key);
  if (!handler) throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  // Deny-by-default: ONLY an explicit `isPublic === true` may serve the browser.
  // Internal functions carry `isInternal: true` with `isPublic` absent — the old
  // `=== false` check refused nothing (audit 2026-11-10, P0-1).
  if (!fromServer && handler.isPublic !== true) {
    throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  }
  const ctx = new RequestContext(identity);
  return await handler._handler(ctx as unknown, args ?? {});
}

/** Diagnostics: how many exports each mapped convex module actually has. */
export function describeModules(): Record<string, { exports: number; handlers: number }> {
  const out: Record<string, { exports: number; handlers: number }> = {};
  for (const [name, exports] of Object.entries(MODULES)) {
    const values = Object.values(exports as Record<string, unknown>);
    out[name] = {
      exports: values.length,
      handlers: values.filter((value) => isHandler(value)).length,
    };
  }
  return out;
}

/** Metadata for the client: which functions exist and whether they mutate. */
export function describeFunctions(): Array<{ key: string; kind: string }> {
  const out: Array<{ key: string; kind: string }> = [];
  for (const [key, handler] of registry()) {
    out.push({
      key,
      kind: handler.isMutation ? "mutation" : handler.isAction ? "action" : "query",
    });
  }
  for (const key of Object.keys(OVERRIDES)) out.push({ key, kind: "mutation" });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
