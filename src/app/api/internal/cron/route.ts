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
 * callers without the secret get 401 and nothing executes.
 *
 * Supported jobs (retention and crash-recovery):
 *   - purge-expired-coordinates (logs:purgeExpiredCoords)
 *   - archive-stale-master-temps (users:archiveStaleMasterTemps)
 *   - purge-expired-messages (messages:purgeExpiredMessages)
 *   - derivation-sweep (shifts:sweepDerivationQueue) — crash-recovery sweeper
 *     re-driving un-derived punches recorded in migration 0021's derivation_queue.
 *
 * Rate limiting (audit 2026-11-13, Phase 2.5): shared-store sliding window via
 * jpay_rate_limit_hit RPC (0013_rate_limit_buckets.sql) with in-memory fallback.
 * 10 req/min per job per instance. Limits pg_cron retries / abuse on the high-entropy
 * CRON_SECRET bearer.
 *
 * Invocation contract:
 *   - Method: POST (GET returns 405)
 *   - Header: Authorization: Bearer <CRON_SECRET> (timing-safe check)
 *   - Query params:
 *       - job: required job identifier
 *       - additional params forwarded to internal handler (e.g. batchSize)
 *   - Body: optional JSON payload merged into handler arguments
 *   - Responses:
 *       - 200: { ok: true, job, result }
 *       - 400: { error: "UNKNOWN_JOB" }
 *       - 401: { error: "UNAUTHENTICATED" }
 *       - 429: { error: "RATE_LIMITED" }
 *       - 500: { error: "CRON_FAILED" }
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
  admin: ReturnType<typeof createSupabaseAdminClient> | null,
  key: string,
  windowMs: number,
  limit: number
): Promise<boolean> {
  if (!admin) {
    return rateLimited(key, windowMs, limit);
  }
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

  const url = new URL(request.url, "http://localhost");
  const job = url.searchParams.get("job") ?? "";
  const ref = cronJobRef(job);
  if (!ref) return NextResponse.json({ error: "UNKNOWN_JOB" }, { status: 400 });

  // Rate limit: shared-store sliding window per job (pg_cron may retry)
  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    // Shared rate limiter degraded to in-memory if admin client is not configured
  }
  if (await rateLimitedShared(admin, `cron:${job}`, CRON_WINDOW_MS, CRON_LIMIT)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  // Parse query parameters into job args (excluding reserved 'job' parameter)
  const args: Record<string, unknown> = {};
  for (const [key, val] of url.searchParams.entries()) {
    if (key === "job") continue;
    if (val === "true") args[key] = true;
    else if (val === "false") args[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(val) && Number.isFinite(Number(val))) args[key] = Number(val);
    else args[key] = val;
  }

  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await request.json();
      if (typeof body === "object" && body !== null) {
        Object.assign(args, body);
      }
    } catch {
      // ignore invalid or empty json body
    }
  }

  try {
    const result = await invoke(ref, args, null, /* fromServer */ true);
    return NextResponse.json({ ok: true, job, result });
  } catch (error) {
    console.error("[cron] job failed", job, error);
    return NextResponse.json({ error: "CRON_FAILED" }, { status: 500 });
  }
}

export function GET(): Promise<Response> {
  return Promise.resolve(NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { allow: "POST" } }));
}
