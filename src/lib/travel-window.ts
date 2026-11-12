/**
 * Read horizon for the impossible-travel trailing window.
 *
 * Travel speed is only meaningful across a plausible working horizon: a
 * previous fix older than this cannot produce a "teleport" verdict, and the
 * horizon keeps the read bounded (48 h of one user's inserts).
 *
 * The horizon is applied to `_creationTime` — the range field of the
 * `logs.by_user_time` index — so it is pushed into PostgREST as SQL WHERE and
 * served by `logs_user_time_idx` (userId, _creationTime desc). A `.filter()`
 * predicate would instead be evaluated in JS after every row of the user's
 * history crossed the wire (src/lib/backend/db.ts).
 *
 * The horizon bounds the READ; the SELECTION rule below is by work time
 * (clientReportedTime), which is what the audit required.
 */
export const TRAVEL_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Trailing window of prior fixes for impossible-travel detection.
 *
 * The logs table has no index on clientReportedTime, so a DB-side
 * `.order("desc").take(n)` walks _creationTime (insertion order) — which is
 * wrong for offline replays synced out of order. Callers must pass the full
 * per-user log set (or a superset); this helper returns the n newest by
 * WORK time (clientReportedTime), ties broken by _creationTime desc.
 */
export function trailingWorkTimeWindow<T extends { clientReportedTime: number; _creationTime: number }>(
  logs: readonly T[],
  n: number
): T[] {
  return [...logs]
    .sort((a, b) => b.clientReportedTime - a.clientReportedTime || b._creationTime - a._creationTime)
    .slice(0, n);
}
