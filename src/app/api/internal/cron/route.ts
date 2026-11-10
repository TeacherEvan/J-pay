import "server-only";

import { NextResponse } from "next/server";

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
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!isSmokeKeyValid(bearer, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const job = new URL(request.url).searchParams.get("job") ?? "";
  const ref = cronJobRef(job);
  if (!ref) return NextResponse.json({ error: "UNKNOWN_JOB" }, { status: 400 });
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
