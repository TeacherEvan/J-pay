/**
 * Pair an "out" punch with the nearest earlier unconsumed "in" punch.
 *
 * Walk the punches newest-first, tracking how many outs are still awaiting
 * an in. Each out consumes the nearest following (earlier) unmatched in, so
 * no single `in` is ever paired twice — previously the newest `in` was
 * returned for every out, double-counting duration across sequential pairs.
 *
 * @param punchesDesc punches for the user/site, sorted by ts DESCENDING
 * @param now current server time (ins after `now` are ignored)
 */
export function findUnmatchedInPunch<T extends { type: string; ts: number }>(
  punchesDesc: readonly T[],
  now: number
): T | undefined {
  let pendingOuts = 0;
  for (const p of punchesDesc) {
    if (p.type === "out") {
      pendingOuts++;
      continue;
    }
    if (p.type === "in") {
      if (pendingOuts > 0) {
        pendingOuts--;
        continue; // already consumed by a later out
      }
      if (p.ts < now) return p;
    }
  }
  return undefined;
}
