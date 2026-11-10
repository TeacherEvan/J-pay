import "server-only";

import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, createSupabaseAnonClient } from "@/lib/supabase/server";
import { describeFunctions, describeModules, invoke, type Identity } from "@/lib/backend/runtime";
import { isSmokeKeyValid } from "@/lib/smoke-key";

/**
 * POST /api/backend/call
 *
 * The single door between the browser and Postgres. Body:
 *   { ref: "users:me" | { module, fn }, args?: object }
 *
 * Auth: `Authorization: Bearer <supabase access token>` (the SPA path) or the
 * session cookie set by @supabase/ssr (SSR path). The token is verified with
 * Supabase Auth, then the caller's public.users row decides whether the
 * identity is active at all — the same gate Convex's beforeSessionCreation did.
 *
 * The service role is used for data access; RLS is default-deny and no policy
 * grants the publishable key anything, so this route is the only way in.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { ref?: unknown; args?: Record<string, unknown> };

async function resolveIdentity(request: Request): Promise<Identity | null> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const admin = createSupabaseAdminClient();

  let userId: string | null = null;
  let email: string | undefined;

  if (bearer) {
    const { data, error } = await admin.auth.getUser(bearer);
    if (!error && data.user) {
      userId = data.user.id;
      email = data.user.email ?? undefined;
    }
  }

  if (!userId) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        userId = data.user.id;
        email = data.user.email ?? undefined;
      }
    } catch {
      // no cookie session
    }
  }

  if (!userId) return null;

  const { data: row } = await admin
    .from("users")
    .select("_id, name, email, isActive, archivedAt")
    .eq("_id", userId)
    .maybeSingle();

  if (!row) return null;
  if (!row.isActive || row.archivedAt !== null) {
    throw new ConvexError("INACTIVE_ACCOUNT");
  }

  return { subject: userId, email: email ?? row.email ?? undefined, name: row.name ?? undefined };
}

function errorCode(error: unknown): string {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : "CONVEX_ERROR";
  }
  return "INTERNAL";
}

function statusFor(code: string): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "FORBIDDEN" || code === "INACTIVE_ACCOUNT") return 403;
  if (code.startsWith("UNKNOWN_FUNCTION")) return 404;
  if (code === "INTERNAL") return 500;
  return 400;
}

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (!body?.ref) {
    return NextResponse.json({ error: "MISSING_REF" }, { status: 400 });
  }

  try {
    const identity = await resolveIdentity(request);
    const result = await invoke(body.ref, body.args ?? {}, identity);
    return NextResponse.json({ result });
  } catch (error) {
    const code = errorCode(error);
    if (code === "INTERNAL") {
      console.error("[backend] call failed", body.ref, error);
    }
    return NextResponse.json(
      {
        error: code,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: statusFor(code) }
    );
  }
}

/**
 * GET /api/backend/call — function inventory for smoke tests.
 *
 * In production the inventory is not public: it discloses every internal
 * handler name (see audit 2026-11-10, P2-3). Require the SMOKE_TEST_KEY
 * shared secret in the `x-smoke-key` header; non-production stays open for
 * local tooling. Missing or wrong key answers 403 either way (fail closed).
 */
export async function GET(request: Request): Promise<Response> {
  if (
    process.env.NODE_ENV === "production" &&
    !isSmokeKeyValid(request.headers.get("x-smoke-key"), process.env.SMOKE_TEST_KEY)
  ) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json({
    functions: describeFunctions(),
    modules: describeModules(),
    linked: true,
    anon: Boolean(createSupabaseAnonClient()),
  });
}
