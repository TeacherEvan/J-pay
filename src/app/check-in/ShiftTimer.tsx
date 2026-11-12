import type { Id } from "../../../convex/_generated/dataModel";
import { formatTime } from "@/lib/format";
import { formatMinutesShort } from "../check-in-card";
import type { Status, Phase, CardLog } from "./types";
import { LABEL } from "./types";
import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

/** Today's cleared minutes + pay, for the shift-card corner. */
function TodayStrip() {
  const me = useQuery(api.users_queries.me);
  // Re-anchor at local midnight so "Today" never means yesterday after a day rollover.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = setInterval(() => {
      setDayKey((prev) => {
        const next = new Date().toDateString();
        return next !== prev ? next : prev;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, []);
  const range = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { fromMs: d.getTime(), toMs: d.getTime() + 24 * 3600 * 1000 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);
  const pay = useQuery(
    api.payroll.calcForEmployee,
    me ? { userId: me._id, fromMs: range.fromMs, toMs: range.toMs } : "skip"
  );
  if (pay === undefined) {
    // Reserve the line so the card doesn't jump when pay arrives (CLS).
    return <p className="tnum min-h-[1.25rem] text-xs text-[var(--fog)]" aria-hidden="true">&nbsp;</p>;
  }
  if (pay.totals.payableMinutes === 0) return <p className="tnum min-h-[1.25rem] text-xs text-[var(--fog)]">Today 0h · <span className="text-[var(--paper)] font-medium">{formatCurrency(0, pay.currency, pay.locale)}</span></p>;
  return (
    <p className="tnum text-xs text-[var(--fog)]">
      Today {formatMinutesShort(pay.totals.payableMinutes)} ·{" "}
      <span className="text-[var(--paper)] font-medium">
        {formatCurrency(pay.totals.pay, pay.currency, pay.locale)}
      </span>
    </p>
  );
}

// Shift chronometer component with strict tabular-nums readout
export interface ShiftClockProps {
  phase: Phase;
  last?: CardLog;
  loaded: boolean;
  userLocale?: string;
  siteName?: string;
  /** Current open segment's startedAt (from deriveSegments), or first event of today. */
  shiftAnchorMs?: number;
}

// Shift chronometer display with tabular-nums enforcement
export function ShiftTimer({
  phase,
  last,
  loaded,
  userLocale,
  siteName,
  shiftAnchorMs,
}: ShiftClockProps) {
  // U14: the 1 Hz tick lives HERE, not at the card root, so the timeline and
  // everything else on the card doesn't re-render every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const clockAnchor = last ? (last.clientReportedTime ?? last._creationTime) : null;
  // While on shift/break, elapsed and "since" anchor to the open segment's
  // start (payroll's segment machine), falling back to the last event only
  // when no anchor was supplied.
  const shiftAnchor = phase !== "off" ? (shiftAnchorMs ?? clockAnchor) : clockAnchor;
  const elapsed = phase !== "off" && shiftAnchor != null ? now - shiftAnchor : null;

  return (
    <div
      className={`card-surgical telemetry-chassis tnum relative overflow-hidden p-5 transition-colors duration-300 [font-variant-numeric:tabular-nums] ${
        phase === "on"
          ? "border-[var(--hivis)]/60 bg-[var(--hivis)]/[0.08]"
          : phase === "break"
            ? "border-[var(--hivis)]/35 bg-[var(--hivis)]/[0.04]"
            : "border-[var(--line)] bg-[var(--panel)]"
      }`}
    >
      {phase === "on" && (
        <div
          className="pointer-events-none absolute -left-12 -top-12 h-44 w-44 rounded-full bg-[var(--hivis)]/15 blur-2xl"
          aria-hidden="true"
        />
      )}
      <div className="relative flex items-center justify-between gap-3">
        <p
          className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${
            phase === "off" ? "text-[var(--fog)]" : "text-[var(--hivis)]"
          }`}
        >
          <span
            className={`pulse-dot inline-block h-2.5 w-2.5 rounded-full ${
              phase === "on"
                ? "bg-[var(--hivis)] shadow-[0_0_8px_var(--hivis)]"
                : phase === "break"
                  ? "bg-[var(--hivis)]/70 shadow-[0_0_6px_var(--hivis)]"
                  : "bg-[var(--fog)]"
            }`}
          />
          {phase === "on"
            ? "On the clock"
            : phase === "break"
              ? `On break · ${last ? LABEL[last.status as Status] : ""}`
              : "Off the clock"}
        </p>
        <TodayStrip />
      </div>

      <p className="tnum font-mono relative mt-2 text-5xl font-semibold tracking-tight text-[var(--paper)] [font-variant-numeric:tabular-nums_lining-nums]" aria-live="off">
        {!loaded ? "··:··:··" : elapsed !== null ? formatElapsed(elapsed) : "—:—:—"}
      </p>

      <p className="tnum relative mt-1.5 text-sm text-[var(--fog)] [font-variant-numeric:tabular-nums_lining-nums]">
        {!loaded
          ? "Reading your latest event…"
          : phase === "off"
            ? last
              ? <>Last event: {LABEL[last.status as Status]} at <span className="tnum font-medium text-[var(--paper)] [font-variant-numeric:tabular-nums_lining-nums]">{shiftAnchor != null ? formatTime(shiftAnchor, userLocale) : "—"}</span></>
              : "Your shift hasn't started yet."
            : <>{siteName ? `At ${siteName}` : "On shift"} since <span className="tnum font-medium text-[var(--paper)] [font-variant-numeric:tabular-nums_lining-nums]">{shiftAnchor != null ? formatTime(shiftAnchor, userLocale) : "—"}</span></>}
      </p>
    </div>
  );
}
