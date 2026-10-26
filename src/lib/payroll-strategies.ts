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
const roundCents = (n: number) => Math.round(n * 100) / 100;

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

function linePay(o: number, ot: number, sun: number, rate: number): number {
  return roundCents(
    (o / 60) * rate +
      (ot / 60) * rate * P.overtimeMultiplier +
      (sun / 60) * rate * P.sundayMultiplier
  );
}

function computeFlat(days: PayInputDay[], rate: number): PayResult {
  const lines = days.map(({ day, minutes }) => ({
    day,
    ordinaryMinutes: minutes,
    overtimeMinutes: 0,
    sundayMinutes: 0,
    pay: roundCents((minutes / 60) * rate),
  }));
  return finalize("flat", lines);
}

function computeDailyOvertime(days: PayInputDay[], rate: number): PayResult {
  const thresholdMin = P.dailyOvertimeThresholdHours * 60;
  const lines = days.map(({ day, minutes }) => {
    const ot = Math.max(0, minutes - thresholdMin);
    const o = minutes - ot;
    return {
      day,
      ordinaryMinutes: o,
      overtimeMinutes: ot,
      sundayMinutes: 0,
      pay: linePay(o, ot, 0, rate),
    };
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

  const lines: PayLine[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      if (isSunday(day)) {
        lines.push({
          day,
          ordinaryMinutes: 0,
          overtimeMinutes: 0,
          sundayMinutes: minutes,
          pay: linePay(0, 0, minutes, rate),
        });
        continue;
      }
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push({
        day,
        ordinaryMinutes: ordinary,
        overtimeMinutes: ot,
        sundayMinutes: 0,
        pay: linePay(ordinary, ot, 0, rate),
      });
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

  const lines: PayLine[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push({
        day,
        ordinaryMinutes: ordinary,
        overtimeMinutes: ot,
        sundayMinutes: 0,
        pay: linePay(ordinary, ot, 0, rate),
      });
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

  const lines: PayLine[] = [];
  for (const [, weekDays] of weeks) {
    let capLeft = weeklyCapMin;
    for (const { day, minutes } of weekDays) {
      const ordinary = Math.min(minutes, Math.max(0, capLeft));
      capLeft -= ordinary;
      const ot = minutes - ordinary;
      lines.push({
        day,
        ordinaryMinutes: ordinary,
        overtimeMinutes: ot,
        sundayMinutes: 0,
        pay: roundCents((minutes / 60) * rate),
      });
    }
  }
  lines.sort((a, b) => a.day.localeCompare(b.day));
  return finalize("wtr_uk", lines);
}

function finalize(strategy: PayStrategyName, lines: PayLine[]): PayResult {
  const t = lines.reduce(
    (a, l) => ({
      ordinaryMinutes: a.ordinaryMinutes + l.ordinaryMinutes,
      overtimeMinutes: a.overtimeMinutes + l.overtimeMinutes,
      sundayMinutes: a.sundayMinutes + l.sundayMinutes,
      pay: roundCents(a.pay + l.pay),
    }),
    { ordinaryMinutes: 0, overtimeMinutes: 0, sundayMinutes: 0, pay: 0 }
  );
  return {
    strategy,
    lines,
    totals: {
      ...t,
      payableMinutes:
        t.ordinaryMinutes + t.overtimeMinutes + t.sundayMinutes,
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
