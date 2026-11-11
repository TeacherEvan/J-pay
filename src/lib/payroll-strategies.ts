import { jpayConfig } from "../config/jpay.config";

export type PayStrategyName = "flat" | "bcea" | "dailyOvertime" | "flsa" | "wtr_uk";

export interface PayInputDay {
  day: string;
  minutes: number;
}

export interface PayLine {
  day: string;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  sundayMinutes: number;
  pay: number;
}

export interface PayResult {
  strategy: PayStrategyName;
  lines: PayLine[];
  totals: {
    ordinaryMinutes: number;
    overtimeMinutes: number;
    sundayMinutes: number;
    payableMinutes: number;
    pay: number;
  };
}

const P = jpayConfig.payrollRules;

/**
 * Exact rational → integer cents, rounding half away from zero on the TRUE
 * rational product (not on a float approximation). Math.round(n*100)/100
 * under-rounded exact half-cent products (audit P2-B10) because n*100 is
 * not always exactly representable. Rates and multipliers are parsed from
 * their shortest round-trip decimal string, so 1.5 and 2.0 are exact.
 */
function rationalFromNumber(x: number): { n: bigint; d: bigint } {
  let s = x.toString();
  if (/e/i.test(s)) {
    s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  }
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const dot = s.indexOf(".");
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const fracPart = dot === -1 ? "" : s.slice(dot + 1);
  let n = BigInt((intPart || "0") + fracPart);
  const d = 10n ** BigInt(fracPart.length);
  if (neg) n = -n;
  return { n, d };
}

/** Exact cents for minutes × rate × multiplier (minutes integer). */
function centsExact(minutes: number, rate: number, multiplier: number): number {
  const r = rationalFromNumber(rate);
  const m = rationalFromNumber(multiplier);
  const num0 = BigInt(Math.trunc(minutes)) * r.n * m.n * 100n;
  const den = r.d * m.d * 60n;
  const neg = num0 < 0n;
  const a = neg ? -num0 : num0;
  const q = a / den;
  const rem = a % den;
  let cents = rem * 2n >= den ? q + 1n : q; // round half away from zero
  if (neg) cents = -cents;
  return Number(cents);
}

export function isSunday(day: string): boolean {
  const d = new Date(`${day}T12:00:00Z`);
  return d.getUTCDay() === 0;
}

export function mondayOfWeek(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

export function weeklyCapMinutes(strategy: PayStrategyName): number | null {
  switch (strategy) {
    case "bcea":
      return 45 * 60;
    case "flsa":
      return 40 * 60;
    case "wtr_uk":
      return 48 * 60;
    case "flat":
    case "dailyOvertime":
      return null;
  }
}

/** Internal line carrying integer cents so finalize sums exactly. */
type LineCents = PayLine & { payCents: number };

function linePayCents(o: number, ot: number, sun: number, rate: number): number {
  return (
    centsExact(o, rate, 1) +
    centsExact(ot, rate, P.overtimeMultiplier) +
    centsExact(sun, rate, P.sundayMultiplier)
  );
}

function toLine(day: string, ordinaryMinutes: number, overtimeMinutes: number, sundayMinutes: number, payCents: number): LineCents {
  return { day, ordinaryMinutes, overtimeMinutes, sundayMinutes, payCents, pay: payCents / 100 };
}

function computeFlat(days: PayInputDay[], rate: number): PayResult {
  const lines: LineCents[] = days.map(({ day, minutes }) =>
    toLine(day, minutes, 0, 0, centsExact(minutes, rate, 1))
  );
  return finalize("flat", lines);
}

function computeDailyOvertime(days: PayInputDay[], rate: number): PayResult {
  const thresholdMin = P.dailyOvertimeThresholdHours * 60;
  const lines = days.map(({ day, minutes }) => {
    const ot = Math.max(0, minutes - thresholdMin);
    const o = minutes - ot;
    return toLine(day, o, ot, 0, linePayCents(o, ot, 0, rate));
  });
  return finalize("dailyOvertime", lines);
}

function computeBcea(days: PayInputDay[], rate: number): PayResult {
  const weeklyCapMin = P.standardWorkWeekHours * 60;

  const weeks = new Map<string, PayInputDay[]>();
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const wk = mondayOfWeek(d.day);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(d);
  }

  const lines: LineCents[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      if (isSunday(day)) {
        lines.push(toLine(day, 0, 0, minutes, linePayCents(0, 0, minutes, rate)));
        continue;
      }
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push(toLine(day, ordinary, ot, 0, linePayCents(ordinary, ot, 0, rate)));
    }
  }
  lines.sort((a, b) => a.day.localeCompare(b.day));
  return finalize("bcea", lines);
}

function computeFlsa(days: PayInputDay[], rate: number): PayResult {
  const weeklyCapMin = 40 * 60;

  const weeks = new Map<string, PayInputDay[]>();
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const wk = mondayOfWeek(d.day);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(d);
  }

  const lines: LineCents[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push(toLine(day, ordinary, ot, 0, linePayCents(ordinary, ot, 0, rate)));
    }
  }
  lines.sort((a, b) => a.day.localeCompare(b.day));
  return finalize("flsa", lines);
}

function computeWtrUk(days: PayInputDay[], rate: number): PayResult {
  // UK has no statutory OT premium. overtimeMinutes is tracked for
  // regulatory reporting only (Working Time Regulations 1998 48h weekly
  // cap); pay is straight time.
  const weeklyCapMin = 48 * 60;

  const weeks = new Map<string, PayInputDay[]>();
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const wk = mondayOfWeek(d.day);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(d);
  }

  const lines: LineCents[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push(toLine(day, ordinary, ot, 0, centsExact(minutes, rate, 1)));
    }
  }
  lines.sort((a, b) => a.day.localeCompare(b.day));
  return finalize("wtr_uk", lines);
}

function finalize(strategy: PayStrategyName, lines: LineCents[]): PayResult {
  let ordinaryMinutes = 0, overtimeMinutes = 0, sundayMinutes = 0, payCents = 0;
  for (const l of lines) {
    ordinaryMinutes += l.ordinaryMinutes;
    overtimeMinutes += l.overtimeMinutes;
    sundayMinutes += l.sundayMinutes;
    payCents += l.payCents; // exact integer sum — no float drift
  }
  const outLines: PayLine[] = lines.map(({ payCents: _pc, ...rest }) => rest);
  return {
    strategy,
    lines: outLines,
    totals: {
      ordinaryMinutes,
      overtimeMinutes,
      sundayMinutes,
      payableMinutes: ordinaryMinutes + overtimeMinutes + sundayMinutes,
      pay: payCents / 100,
    },
  };
}

export function computePay(
  days: PayInputDay[],
  rate: number,
  strategy: PayStrategyName = P.strategy
): PayResult {
  if (!Number.isFinite(rate) || rate < 0) throw new Error("INVALID_RATE");
  if (!days.length) {
    return {
      strategy,
      lines: [],
      totals: {
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        sundayMinutes: 0,
        payableMinutes: 0,
        pay: 0,
      },
    };
  }
  if (strategy === "bcea") return computeBcea(days, rate);
  if (strategy === "dailyOvertime") return computeDailyOvertime(days, rate);
  if (strategy === "flsa") return computeFlsa(days, rate);
  if (strategy === "wtr_uk") return computeWtrUk(days, rate);
  return computeFlat(days, rate);
}
