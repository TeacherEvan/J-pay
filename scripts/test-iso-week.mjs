/**
 * F2 regression (audit 2026-11-13, P1): the payroll panel built its ISO-week
 * window in the BROWSER timezone while the server buckets days in the SITE
 * timezone — so a site Monday that starts before browser-local midnight had
 * its first paid hours selected in no period at all, silently under-paying.
 *
 * The fix is a shared pure helper that computes ISO-week bounds IN A GIVEN
 * timezone. These cases discriminate it from the old client-local math:
 * a naive `setHours(0,0,0,0)` Monday anchor in any behind-site zone would
 * produce a fromMs LATER than the correct site Monday and fail case (3).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { siteWeekRange, zonedTimeToUtc } from "../src/lib/iso-week.ts";

// Same semantics as localDayKey (en-CA → YYYY-MM-DD in a timezone).
const localDayKey = (ms, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

test("siteWeekRange: UTC zone is a plain UTC ISO week (Mon-Sun)", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0); // Wed 2026-11-11T09:00Z
  const r = siteWeekRange(anchor, "UTC", 1, 0);
  assert.equal(r.fromDay, "2026-11-09");
  assert.equal(r.toDay, "2026-11-15");
  assert.equal(r.fromMs, Date.UTC(2026, 10, 9, 0, 0));
  assert.equal(r.toMs, Date.UTC(2026, 10, 16, 0, 0) - 1);
  assert.equal(r.timezone, "UTC");
});

test("siteWeekRange: Africa/Johannesburg week starts Sunday 22:00Z (site Monday, no DST)", () => {
  const anchor = Date.UTC(2026, 10, 9, 5, 30); // Mon 2026-11-09T05:30Z = SAST 07:30 Mon 9th
  const r = siteWeekRange(anchor, "Africa/Johannesburg", 1, 0);
  assert.equal(r.fromDay, "2026-11-09");
  assert.equal(r.fromMs, Date.UTC(2026, 10, 8, 22, 0), "site Monday 00:00 SAST is Sunday 22:00Z");
  assert.equal(r.toDay, "2026-11-15");
  assert.equal(r.toMs, Date.UTC(2026, 10, 15, 22, 0) - 1);
});

test("siteWeekRange: a behind-site browser zone must NOT select before the site Monday", () => {
  // anchor = SAST Mon 2026-11-09T05:00Z. A browser at UTC-5 (New York, standard time)
  // computing its own local Monday would start at Date.UTC(2026,10,9,5) == SAST Mon 07:00,
  // i.e. AFTER the site Monday 22:00Z — inside the correct week. The site-timezone
  // boundary must include SAST Monday 00:00–07:00 (in cron-free day buckets).
  const anchor = Date.UTC(2026, 10, 9, 5, 0);
  const r = siteWeekRange(anchor, "Africa/Johannesburg", 1, 0);
  assert.equal(r.fromMs, Date.UTC(2026, 10, 8, 22, 0));
  assert.ok(localDayKey(r.fromMs, "Africa/Johannesburg") === "2026-11-09");
  assert.ok(localDayKey(r.toMs, "Africa/Johannesburg") === "2026-11-15");
  assert.notEqual(localDayKey(r.fromMs - 1, "Africa/Johannesburg"), "2026-11-09");
  assert.notEqual(localDayKey(r.toMs + 1, "Africa/Johannesburg"), "2026-11-15");
});

test("siteWeekRange: two weeks in the past spans exactly 14 site-local days", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0); // Wed 2026-11-11
  const r = siteWeekRange(anchor, "Africa/Johannesburg", 2, -1);
  assert.equal(r.fromDay, "2026-10-26");
  assert.equal(r.toDay, "2026-11-08");
  assert.equal(localDayKey(r.fromMs, "Africa/Johannesburg"), "2026-10-26");
  assert.equal(localDayKey(r.toMs, "Africa/Johannesburg"), "2026-11-08");
});

test("siteWeekRange: America/New_York week containing US DST transition spans correctly", () => {
  const anchor = Date.UTC(2026, 2, 11, 9, 0); // Wed 2026-03-11T09:00Z (DST sprang forward Mar 8)
  const r = siteWeekRange(anchor, "America/New_York", 1, 0);
  assert.equal(r.fromDay, "2026-03-09");
  // Mon 2026-03-09 00:00 EDT = 04:00Z (DST sprang forward on Mar 8)
  assert.equal(r.fromMs, Date.UTC(2026, 2, 9, 4, 0));
  // Mon 2026-03-16T00:00 EDT = 04:00Z; interval ends at the ms before it
  const endExclusive = zonedTimeToUtc(2026, 3, 16, 0, 0, "America/New_York");
  assert.equal(r.toMs, endExclusive - 1);
  assert.equal(endExclusive, Date.UTC(2026, 2, 16, 4, 0));
});

test("siteWeekRange: invalid timezone falls back to UTC", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0);
  const r = siteWeekRange(anchor, "Not/AZone", 1, 0);
  assert.equal(r.timezone, "UTC");
  assert.equal(r.fromMs, Date.UTC(2026, 10, 9, 0, 0));
});

test("siteWeekRange: four weeks window ends at the current week and spans 28 days", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0);
  const r = siteWeekRange(anchor, "UTC", 4, 0);
  assert.equal(r.fromMs, Date.UTC(2026, 9, 19, 0, 0));
  assert.equal(r.toMs, Date.UTC(2026, 10, 16, 0, 0) - 1);
  assert.equal((r.toMs - r.fromMs + 1) % DAY, 0);
  assert.equal((r.toMs - r.fromMs + 1) / DAY, 28);
});

test("siteWeekRange: two weeks offset 0 shows current + previous ISO week", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0);
  const r = siteWeekRange(anchor, "Africa/Johannesburg", 2, 0);
  assert.equal(r.fromDay, "2026-11-02");
  assert.equal(r.toDay, "2026-11-15");
});

test("siteWeekRange: two weeks stepped back one block shows the previous block", () => {
  const anchor = Date.UTC(2026, 10, 11, 9, 0);
  const r = siteWeekRange(anchor, "UTC", 2, -2);
  assert.equal(r.fromDay, "2026-10-19");
  assert.equal(r.toDay, "2026-11-01");
});
