import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { invoke } from "@/lib/backend/runtime";
import { isSmokeKeyValid } from "@/lib/smoke-key";
import { cronJobRef } from "@/lib/cron-jobs";

/**
 * POST /api/internal/cron?job=<name> — pg_cron's only door into the job
 * registry. Bearer CRON_SECRET required; unknown jobs 400; handler failures
 * 500 (pg_cron records the status code). Never callable by the browser:
 * callers without the secret get 401 and nothing executes. Jobs are the
 * same internal handlers convex/crons.ts used to schedule (retention tier
 * re-wired for the Supabase-authoritative deployment — audit 2026-11-10, P1-4).
 *
 * Rate limiting (audit 2026-11-13, Phase 2.5): shared-store sliding window via
 * jpay_rate_limit_hit RPC (0013_rate_limit_buckets.sql) with in-memory fallback.
 * Limits pg_cron retries / abuse on the high-entropy CRON_SECRET bearer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 10 req/min per job per instance (degraded to in-memory if RPC unavailable)
const CRON_WINDOW_MS = 60_000;
const CRON_LIMIT = 10;
const cronHits = new Map<string, number[]>();

function rateLimited(key: string, windowMs: number, limit: number): boolean {
  const now = Date.now();
  const list = (cronHits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    cronHits.set(key, list);
    return true;
  }
  list.push(now);
  cronHits.set(key, list);
  return false;
}

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
    console.warn("[cron] shared rate limiter unavailable, using in-memory fallback", error?.message);
    return rateLimited(key, windowMs, limit);
  }
  return data;
}

export async function POST(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!isSmokeKeyValid(bearer, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const job = new URL(request.url).searchParams.get("job") ?? "";
  const ref = cronJobRef(job);
  if (!ref) return NextResponse.json({ error: "UNKNOWN_JOB" }, { status: 400 });

  // Rate limit: shared-store sliding window per job (pg_cron may retry)
  const admin = createSupabaseAdminClient();
  if (await rateLimitedShared(admin, `cron:${job}`, CRON_WINDOW_MS, CRON_LIMIT)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  try {
    await invoke(ref, {}, null, /* fromServer */ true);
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    console.error("[cron] job failed", job, error);
    return NextResponse.json({ error: "CRON_FAILED" }, { status: 500 });
  }
}

export function GET(): Promise<Response> {
  return Promise.resolve(NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { allow: "POST" } }));
}
