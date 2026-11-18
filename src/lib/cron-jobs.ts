/**
 * Retention and crash-recovery background jobs the Supabase-authoritative deployment
 * executes via `POST /api/internal/cron?job=<name>` (see supabase/migrations/archive/0003_retention_crons.OWNER_ONLY.sql
 * and supabase/migrations/0021_derivation_queue.sql).
 *
 * These are internal handlers from the Convex-shaped module registry (never
 * callable from the browser — the 2026-11-10 security gate refuses them);
 * the cron route is their only scheduled caller. Keep idempotent — each job
 * re-runs safely if pg_cron retries.
 *
 * Job Inventory:
 *  - "purge-expired-coordinates": Purges GPS coordinates older than retention limit.
 *  - "archive-stale-master-temps": Archives expired break-glass temporary moderator accounts.
 *  - "purge-expired-messages": Purges broadcast messages past retention expiry.
 *  - "derivation-sweep": Derivation crash-net sweeper (shifts:sweepDerivationQueue).
 *    Processes pending punch events from `derivation_queue` (migration 0021) whose
 *    inline shift re-derivation hard-crashed (e.g. process termination, unhandled exception).
 *    Executes every minute via cron. Gracefully returns `{ swept: 0, failed: 0, skipped: true }`
 *    if migration 0021 is not yet applied.
 */
export const CRON_JOBS = {
  "purge-expired-coordinates": { module: "logs", fn: "purgeExpiredCoords" },
  "archive-stale-master-temps": { module: "users", fn: "archiveStaleMasterTemps" },
  "purge-expired-messages": { module: "messages", fn: "purgeExpiredMessages" },
  // Re-drive shift derivation for punches whose commit hard-crashed before the
  // inline derive ran (migration 0021, owner-applied; no-op until then).
  // Invoked via POST /api/internal/cron?job=derivation-sweep with CRON_SECRET bearer.
  // Optional query params: ?batchSize=<number> to constrain per-sweep batch size.
  "derivation-sweep": { module: "shifts", fn: "sweepDerivationQueue" },
} as const;

/** Resolve a job name to its internal function ref, or null if unknown. */
export function cronJobRef(job: string): { module: string; fn: string } | null {
  return (CRON_JOBS as Record<string, { module: string; fn: string }>)[job] ?? null;
}
