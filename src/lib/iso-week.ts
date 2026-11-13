/**
 * Site-timezone ISO-week arithmetic.
 *
 * The payroll panel knows only AUTH intent ("the ISO week the user is looking at"),
 * not which timezone the site runs in. Computing week bounds in the BROWSER zone
 * under-selects when the browser trails the site zone (audit 2026-11-13, F2 — a
 * night-shift worker's first paid day vanished). This module is the shared,
 * timezone-aware boundary calculator used by both the server (authoritative)
 * and the unit tests.
 */

export interface SiteWeekRange {
  /** UTC ms of site-local Monday 00:00 of the first week. */
  fromMs: number;
  /** UTC ms of the final site-local day 23:59:59.999 of the last week. */
  toMs: number;
  /** ISO YYYY-MM-DD of the first day (as reported by localDayKey). */
  fromDay: string;
  /** ISO YYYY-MM-DD of the last day. */
  toDay: string;
  /** Normalised timezone (falls back to UTC). */
  timezone: string;
}

const DAY_MS = 24 * 3600 * 1000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** en-CA-ish "YYYY-MM-DD" for a UTC-anchored calendar date (all arithmetic below runs in calendar space). */
function ymd(dateUtcMs: number): string {
  const d = new Date(dateUtcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

function localParts(instantMs: number, timeZone: string): LocalParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(instantMs))) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  } catch {
    return null; // invalid timezone — handled by caller
  }
}

/** Offset at `instantMs`, i.e. local − UTC, in ms. Seconds precision. */
export function tzOffsetMs(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone) ?? localParts(instantMs, "UTC")!;
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/** UTC ms of site-local wall-clock `y-M-D h:m:00` in `timeZone`. Resolves DST twice to land on the right side. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - tzOffsetMs(guess, timeZone);
  const off2 = tzOffsetMs(utc, timeZone);
  if (off2 !== tzOffsetMs(guess, timeZone)) {
    utc = guess - off2;
  }
  return utc;
}

/** ISO weekday with Monday = 0 for a UTC-calendar date (use for local calendar dates only). */
function mon0(utcd: number): number {
  return (new Date(utcd).getUTCDay() + 6) % 7;
}

/** UTC calendar date (ms) from y/m/d. */
function utcDate(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

/**
 * Compute the `weeks`-long ISO-week window containing `anchorMs`, shifted by `weekOffset`
 * (negative = past), expressed in UTC ms and labelled in site-local day keys.
 */
export function siteWeekRange(
  anchorMs: number,
  timeZone: string,
  weeks: 1 | 2 | 4,
  weekOffset: number,
): SiteWeekRange {
  // Fall back to UTC on invalid zone names (same posture as localDayKey).
  let tz = timeZone;
  if (localParts(anchorMs, tz) === null) tz = "UTC";

  const p = localParts(anchorMs, tz)!;
  const localUtcMidnight = utcDate(p.year, p.month, p.day);
  const monday = localUtcMidnight - mon0(localUtcMidnight) * DAY_MS;
  // Windows end at the ISO week containing `anchorMs`; `weekOffset` (in whole
  // weeks) shifts the block backwards (negative = older window). weeks=2
  // shows the current week plus the previous one, so the label "This week /
  // 2 weeks / 4 weeks" always looks BACKWARDS in time.
  const start = monday - (weeks - 1) * 7 * DAY_MS + weekOffset * 7 * DAY_MS;
  const end = start + weeks * 7 * DAY_MS; // exclusive

  const fromParts = new Date(start);
  const toParts = new Date(end);
  const fromMs = zonedTimeToUtc(fromParts.getUTCFullYear(), fromParts.getUTCMonth() + 1, fromParts.getUTCDate(), 0, 0, tz);
  const toExclusive = zonedTimeToUtc(toParts.getUTCFullYear(), toParts.getUTCMonth() + 1, toParts.getUTCDate(), 0, 0, tz);
  return {
    fromMs,
    toMs: toExclusive - 1,
    fromDay: ymd(start),
    toDay: ymd(end - DAY_MS),
    timezone: tz,
  };
}
