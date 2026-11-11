import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminKey } from "@/lib/supabase/admin";

/**
 * GET /api/health/db — B5 (2026-11-10), completed 2026-11-11-11.
 *
 * Deploy-order probe. The app must never deploy ahead of the migrations it reads. This
 * unauthenticated route returns 200 { ok: true, tables: N } when every object the current
 * code reads exists, or 503 with the missing object names so the failure is loud and
 * debuggable instead of a silent stale payroll.
 *
 * Note: `tables` is the count of PROBED objects, not the database's total table count —
 * earlier versions reported a hard-coded 16 while the DB had 17 tables + 1 view. The value
 * tracks REQUIRED_TABLES exactly, which is the verifiable claim.
 *
 * Safe to expose: names only, no data, no keys.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  "users",
  "organisations",
  "sites",
  "punches",
  "userSites",
  "logs",
  "shifts",
  "messages",
  "pushSubscriptions",
  "purgeAudit",
  "reviewResolutions",
  "demoSessions",
  "managerSites",
  "travelSegments",
  "shiftOverrides",
  "systemEvents",
  "jpay_rate_limits",
  "jpay_id_registry",
] as const;

export async function GET(): Promise<Response> {
  if (!hasSupabaseAdminKey()) {
    return NextResponse.json({ ok: false, error: "SERVICE_ROLE_KEY_MISSING" }, { status: 503 });
  }
  const admin = createSupabaseAdminClient();
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await admin.from(table).select("*", { head: true, count: "exact" }).limit(1);
    if (error) {
      // 42P01 = undefined_table; anything else (permissions, network) also means "unhealthy"
      missing.push(table);
    }
  }
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, missing }, { status: 503 });
  }
  return NextResponse.json({ ok: true, tables: REQUIRED_TABLES.length });
}
