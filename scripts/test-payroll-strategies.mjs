import assert from "node:assert/strict";
import { computePay, isSunday, mondayOfWeek } from "../src/lib/payroll-strategies.ts";

const R = 100; // R100/h

// flat
{
  const r = computePay([{ day: "2026-08-03", minutes: 600 }], R, "flat");
  assert.equal(r.totals.pay, 1000);
  assert.equal(r.strategy, "flat");
}

// bcea under weekly threshold: all ordinary
{
  const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"].map(
    (day) => ({ day, minutes: 480 })
  );
  const r = computePay(days, R, "bcea");
  assert.equal(r.totals.ordinaryMinutes, 2400);
  assert.equal(r.totals.overtimeMinutes, 0);
  assert.equal(r.totals.pay, 4000);
}

// bcea 50h week -> 45 @1x + 5 @1.5x (Mon-Fri order)
{
  const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"].map(
    (day) => ({ day, minutes: 600 }) // 10h/day = 50h week
  );
  const r = computePay(days, R, "bcea");
  assert.equal(r.totals.ordinaryMinutes, 2700);
  assert.equal(r.totals.overtimeMinutes, 300);
  assert.equal(r.totals.pay, 2700 / 60 * R + 300 / 60 * R * 1.5);
}

// sunday minutes at 2x, excluded from accumulation
{
  const days = [
    { day: "2026-08-09", minutes: 240 }, // Sunday
  ];
  const r = computePay(days, R, "bcea");
  assert.equal(r.totals.sundayMinutes, 240);
  assert.equal(r.totals.pay, 4 * R * 2);
}

// sunday + heavy week: no double dip
{
  const days = [
    ...["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].map((day) => ({
      day,
      minutes: 720, // 12h x4 = 48h non-sunday
    })),
    { day: "2026-08-09", minutes: 120 }, // Sunday 2h
  ];
  const r = computePay(days, R, "bcea");
  assert.equal(r.totals.ordinaryMinutes, 2700); // cap 45h on non-sunday
  assert.equal(r.totals.overtimeMinutes, 180); // 3h over
  assert.equal(r.totals.sundayMinutes, 120);
  const expect = (2700 / 60) * R + (180 / 60) * R * 1.5 + (120 / 60) * R * 2;
  assert.ok(Math.abs(r.totals.pay - expect) < 0.001);
}

// daily overtime: 10h day -> 8 @1x + 2 @1.5x; 7h day untouched
{
  const r = computePay(
    [
      { day: "2026-08-03", minutes: 600 },
      { day: "2026-08-04", minutes: 420 },
    ],
    R,
    "dailyOvertime"
  );
  assert.equal(r.lines[0].overtimeMinutes, 120);
  assert.equal(r.lines[1].overtimeMinutes, 0);
  assert.equal(r.totals.pay, (480 / 60) * R + (120 / 60) * R * 1.5 + (420 / 60) * R);
}

// multi-week isolation: OT does not leak across Monday boundary
{
  const r = computePay(
    [{ day: "2026-08-07", minutes: 3300 }, { day: "2026-08-10", minutes: 300 }], // Fri 55h; Mon next wk 5h
    R,
    "bcea"
  );
  const fri = r.lines.find((l) => l.day === "2026-08-07");
  const mon = r.lines.find((l) => l.day === "2026-08-10");
  assert.equal(fri.ordinaryMinutes, 2700);
  assert.equal(fri.overtimeMinutes, 600);
  assert.equal(mon.ordinaryMinutes, 300);
}

// helpers
assert.equal(isSunday("2026-08-09"), true);
assert.equal(isSunday("2026-08-10"), false);
assert.equal(mondayOfWeek("2026-08-09"), "2026-08-03");

// guards
assert.throws(() => computePay([{ day: "2026-08-03", minutes: 60 }], -1));
assert.equal(computePay([], R).totals.payableMinutes, 0);

console.log("payroll-strategies: all assertions passed");
