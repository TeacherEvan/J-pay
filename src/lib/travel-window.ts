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
