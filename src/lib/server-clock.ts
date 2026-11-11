/**
 * Client-side calibration against the server clock (audit 2026-11-11, P1-B2).
 *
 * The payroll engine compares client-supplied timestamps against the server
 * clock and flags punches queued more than REPLAY_REVIEW_MS ago as offline
 * replays — but a device whose clock is ≥5 minutes off made *every* punch look
 * like a replay, silently holding the shift out of pay (R0.00).
 *
 * Fix: learn the device↔server offset from the `Date` response header (a
 * safelisted header every browser can read on same-origin fetches) of any API
 * call. Persist it so it survives reloads and offline gaps. Then stamp every
 * punch entry in *server time* — `clockSkewMs ≈ 0` and `replayMs` measures
 * genuine wall-clock age instead of device error.
 *
 * Properties:
 *  - Pure + deterministic (injectable clock for tests).
 *  - Tolerates storage being blocked (in-memory fallback).
 *  - Never trusts a wildly implausible offset (> 30 days) — that is not skew.
 */

const STORAGE_KEY = "jpay.serverSkewMs";
const MAX_PLAUSIBLE_SKEW_MS = 30 * 24 * 3600 * 1000; // 30 days

let skewMs: number | null = null;
let clock: () => number = () => Date.now();

const isPlausible = (v: number): boolean =>
  Number.isFinite(v) && Math.abs(v) <= MAX_PLAUSIBLE_SKEW_MS;

/** Test hook: replace the device clock (restored by unregisterClock). */
export function registerClock(fn: () => number): void {
  clock = fn;
}
export function unregisterClock(): void {
  clock = () => Date.now();
}

/** Test hook: forget the in-memory estimate AND the persisted offset. */
export function resetServerClockForTests(): void {
  skewMs = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
  }
}

/** Test hook: forget only the in-memory estimate (storage persists) —
 *  this is what a page reload sees. */
export function simulateReloadForTests(): void {
  skewMs = null;
}

/** Feed a `Date` response header value; learn the device↔server offset.
 *  Returns true when the observation was accepted; false when ignored
 *  (missing/unparseable header, or an implausible > 30-day offset — likely a
 *  proxy error or a pathological device clock that must not poison every
 *  future punch timestamp). */
export function observeServerDate(header: string | null | undefined): boolean {
  if (!header) return false;
  const t = Date.parse(header);
  if (Number.isNaN(t)) return false;
  const raw = t - clock();
  if (!isPlausible(raw)) return false;
  skewMs = raw;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(skewMs));
    }
  } catch {
    /* storage blocked — keep the in-memory estimate */
  }
  return true;
}

/** Restore a persisted offset. Returns true if one was available. */
export function restoreServerSkew(): boolean {
  if (skewMs !== null) return true;
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return false;
    const v = Number(raw);
    if (!isPlausible(v)) return false;
    skewMs = v;
    return true;
  } catch {
    return false;
  }
}

/** Device↔server offset in ms (server − device). 0 when unlearned. */
export function serverSkewMs(): number {
  if (skewMs !== null) return skewMs;
  if (restoreServerSkew()) return skewMs ?? 0;
  return 0;
}

/** Current time in server milliseconds. */
export function serverNow(): number {
  return clock() + serverSkewMs();
}
