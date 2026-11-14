/**
 * Retention/cleanup jobs the Supabase-authoritative deployment runs daily
 * via `POST /api/internal/cron?job=<name>` (see supabase/migrations/archive/0003_retention_crons.OWNER_ONLY.sql).
 *
 * These are internal handlers from the Convex-shaped module registry (never
 * callable from the browser — the 2026-11-10 security gate refuses them);
 * the cron route is their only scheduled caller. Keep idempotent — each job
 * re-runs safely if pg_cron retries.
 */
export const CRON_JOBS = {
  "purge-expired-coordinates": { module: "logs", fn: "purgeExpiredCoords" },
  "archive-stale-master-temps": { module: "users", fn: "archiveStaleMasterTemps" },
  "purge-expired-messages": { module: "messages", fn: "purgeExpiredMessages" },
} as const;

/** Resolve a job name to its internal function ref, or null if unknown. */
export function cronJobRef(job: string): { module: string; fn: string } | null {
  return (CRON_JOBS as Record<string, { module: string; fn: string }>)[job] ?? null;
}
