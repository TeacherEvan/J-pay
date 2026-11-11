/**
 * P2-B10 regression: exact half-cent products must round half away from zero.
 * Expected values are computed here with independent BigInt rational math.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computePay } from "../src/lib/payroll-strategies.ts";

// Exact rational cents for minutes × rate × multiplier (rate/multiplier from
// their shortest round-trip decimal string).
function rat(x) {
  let s = x.toString();
  if (/e/i.test(s)) s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  const dot = s.indexOf(".");
  const ip = dot === -1 ? s : s.slice(0, dot), fp = dot === -1 ? "" : s.slice(dot + 1);
  let n = BigInt((ip || "0") + fp); const d = 10n ** BigInt(fp.length);
  return { n: neg ? -n : n, d };
}
function expectedCents(minutes, rate, multiplier = 1) {
  const r = rat(rate), m = rat(multiplier);
  const num = BigInt(minutes) * r.n * m.n * 100n, den = r.d * m.d * 60n;
  const neg = num < 0n, a = neg ? -num : num;
  let q = a / den; const rem = a % den;
  if (rem * 2n >= den) q += 1n;
  return Number(neg ? -q : q);
}

const DAY = "2026-11-09"; // Monday

// Cases whose true product lands exactly on a half-cent — the float path
// (Math.round(n*100)/100) under-rounds these.
const HALF_CENT_CASES = [
  { minutes: 3, rate: 1.10 },   // 5.5¢
  { minutes: 1, rate: 0.90 },   // 1.5¢
  { minutes: 3, rate: 0.30 },   // 1.5¢
  { minutes: 9, rate: 0.10 },   // 1.5¢
  { minutes: 3, rate: 3.30 },   // 16.5¢
  { minutes: 15, rate: 2.50 },  // 62.5¢
];

for (const { minutes, rate } of HALF_CENT_CASES) {
  test(`flat: ${minutes}min @ R${rate} rounds half away from zero`, () => {
    const res = computePay([{ day: DAY, minutes }], rate, "flat");
    const cents = expectedCents(minutes, rate, 1);
    assert.equal(res.lines[0].pay, cents / 100);
    assert.equal(res.totals.pay, cents / 100);
    // float sanity: the naive path really would differ on at least one case
    const naive = Math.round(((minutes / 60) * rate) * 100) / 100;
    if (naive !== cents / 100) {
      assert.notEqual(res.lines[0].pay, naive, "regression guard: must diverge from float path");
    }
  });
}

test("flat: multi-day total equals exact integer-cent sum of lines", () => {
  const days = [
    { day: "2026-11-09", minutes: 3 },
    { day: "2026-11-10", minutes: 3 },
    { day: "2026-11-11", minutes: 1 },
  ];
  const rate = 1.10;
  const res = computePay(days, rate, "flat");
  const sum = days.reduce((acc, d) => acc + expectedCents(d.minutes, rate, 1), 0);
  assert.equal(res.totals.pay, sum / 100);
  assert.equal(res.lines.length, 3);
});

test("bcea: overtime multiplier applied in exact rational domain", () => {
  // 46h in one week at R1.10 → 45h ordinary + 1h OT @ 1.5×
  const week = ["2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14"].map((day) => ({ day, minutes: 460 }));
  const res = computePay(week, 1.10, "bcea");
  // BCEA rounds each day line to cents, then sums integer cents.
  // Mon–Fri: 460 ordinary each; Sat: 400 ordinary (cap 2700) + 60 OT.
  let expected = 0;
  for (let i = 0; i < 5; i++) expected += expectedCents(460, 1.10, 1);
  expected += expectedCents(400, 1.10, 1) + expectedCents(60, 1.10, 1.5);
  assert.equal(res.totals.pay, expected / 100);
});
