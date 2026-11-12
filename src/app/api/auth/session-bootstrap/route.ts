import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminKey } from "@/lib/supabase/admin";

/**
 * POST /api/auth/session-bootstrap
 *
 * Supabase Auth can only sign a user in from the client, so the one
 * server-authorised entry point creates an account with an ephemeral password
 * and hands those credentials back exactly once:
 *
 *   kind: "master"  — break-glass temp moderator (requires MASTER_PASSWORD)
 *
 * Everything else (employees, moderators) signs in normally with the ID code
 * their moderator issued.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B6 fix: in-memory sliding-window rate limit. Serverless instances share no
// state, but this still throttles per-instance abuse and costs nothing;
// complements Supabase-side throttles. Master: 5/hour/IP.
const WINDOW_MASTER_MS = 3_600_000;
const LIMIT_MASTER = 5;
const hits = new Map<string, number[]>();

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function rateLimited(key: string, windowMs: number, limit: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

/**
 * Shared-store limiter backed by Postgres (0013_rate_limit_buckets.sql) via
 * the atomic `jpay_rate_limit_hit` RPC. When the migration is not yet
 * applied the RPC errors and we fall back to the per-instance in-memory
 * limiter — throttling is degraded, never disabled.
 */
async function rateLimitedShared(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  windowMs: number,
  limit: number
): Promise<boolean> {
  const { data, error } = await admin.rpc("jpay_rate_limit_hit", {
    p_bucket: key,
    p_window_ms: windowMs,
    p_limit: limit,
  });
  if (error || typeof data !== "boolean") {
    console.warn("[session-bootstrap] shared rate limiter unavailable, using in-memory fallback", error?.message);
    return rateLimited(key, windowMs, limit);
  }
  return data;
}

type Body = { kind?: string; email?: string; secret?: string };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `JP-${Array.from(bytes, (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("")}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSupabaseAdminKey()) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const admin = createSupabaseAdminClient();
  const password = ephemeralPassword();

  const ip = clientIp(request);

  if (body.kind === "master") {
    if (await rateLimitedShared(admin, `master:${ip}`, WINDOW_MASTER_MS, LIMIT_MASTER)) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const masterPassword = process.env.MASTER_PASSWORD;
    if (!masterPassword) {
      return NextResponse.json({ error: "MASTER_DISABLED" }, { status: 403 });
    }
    if (!body.secret || !constantTimeEqual(body.secret, masterPassword)) {
      return NextResponse.json({ error: "INVALID_MASTER_SECRET" }, { status: 401 });
    }

    const operatorEmail = String(body.email ?? "").trim().toLowerCase();
    const authEmail = `master+${Date.now().toString(36)}@jpay.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { master: true },
    });
    if (error || !data.user) {
      return NextResponse.json({ error: "MASTER_CREATE_FAILED" }, { status: 500 });
    }
    await admin.from("users").insert({
      _id: data.user.id,
      name: operatorEmail.split("@")[0] || "Moderator",
      email: operatorEmail || null,
      role: "moderator",
      isActive: true,
      isMasterTemp: true,
      passwordChangedAt: Date.now(),
    });

    return NextResponse.json({ email: authEmail, password });
  }

  return NextResponse.json({ error: "UNKNOWN_KIND" }, { status: 400 });
}
