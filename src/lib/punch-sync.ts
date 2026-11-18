/**
 * Cross-component concurrency lock serializing every path that writes punches:
 *
 *   - automatic outbox replays (visibilitychange / online / manual Sync now),
 *   - live check-in submissions (the CHECK-IN button).
 *
 * Both funnel into `logs.createLog` on the backend; without a shared order a
 * background replay of a queued (earlier) punch can interleave with a fresh
 * manual punch mid-flight and push the derivation engine into an avoidable
 * out-of-order sandwich. The queue is a simple promise chain — bounded by the
 * 15 s transport deadline in callBackend — so a wedged request ages out rather
 * than wedging the UI forever.
 *
 * (audit 2026-11-17 — offline replay vs live submission race)
 */

let tail: Promise<unknown> = Promise.resolve();

export function withPunchSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
