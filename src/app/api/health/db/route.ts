import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminKey } from "@/lib/supabase/admin";

/**
 * GET /api/health/db — B5 (2026-11-10): deploy-order probe.
 *
 * The app must never deploy ahead of migrations 0003–0010 (table-exists
 * failures otherwise hard-error on the payroll path). This unauthenticated
 * route returns 200 { ok: true } when every table the current code reads
 * exists, or 503 with the missing table names so the failure is loud and
 * debuggable instead of a silent stale payroll.
 *
 * Safe to expose: table names only, no data, no keys.
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
