import type { Id } from "../../../convex/_generated/dataModel";
import { formatTime } from "@/lib/format";
import { formatMinutesShort } from "../check-in-card";
import type { Status, Phase, CardLog } from "./types";
import { LABEL } from "./types";
import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";
import { useMemo } from "react";
import { formatCurrency } from "@/lib/format";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

/** Today's cleared minutes + pay, for the shift-card corner (live only). */
function TodayStrip() {
  const me = useQuery(api.users_queries.me);
  const range = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { fromMs: d.getTime(), toMs: d.getTime() + 36 * 3600 * 1000 };
  }, []);
  const pay = useQuery(
    api.payroll.calcForEmployee,
    me ? { userId: me._id, fromMs: range.fromMs, toMs: range.toMs } : "skip"
  );
  if (!pay || pay.totals.payableMinutes === 0) return null;
  return (
    <p className="tnum text-xs text-[var(--fog)]">
      Today {formatMinutesShort(pay.totals.payableMinutes)} ·{" "}
      <span className="text-[var(--paper)] font-medium">
        {formatCurrency(pay.totals.pay, pay.currency, pay.locale)}
      </span>
    </p>
  );
}

export interface ShiftTimerProps {
  phase: Phase;
  last?: CardLog;
  loaded: boolean;
  now: number;
  userLocale?: string;
  isLive: boolean;
  siteName?: string;
}

export function ShiftTimer({
  phase,
  last,
  loaded,
  now,
  userLocale,
  isLive,
  siteName,
}: ShiftTimerProps) {
  const timerAnchor = last ? (last.clientReportedTime ?? last._creationTime) : null;
  const elapsed = phase !== "off" && timerAnchor ? now - timerAnchor : null;

  return (
    <div
      className={`card-surgical relative overflow-hidden p-5 transition-all duration-300 ${
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
        {isLive && <TodayStrip />}
      </div>

      <p className="tnum relative mt-2 text-5xl font-semibold tracking-tight text-[var(--paper)]" aria-live="off">
        {!loaded ? "··:··:··" : elapsed !== null ? formatElapsed(elapsed) : "—:—:—"}
      </p>

      <p className="tnum relative mt-1.5 text-sm text-[var(--fog)]">
        {!loaded
          ? "Reading your latest event…"
          : phase === "off"
            ? last
              ? <>Last event: {LABEL[last.status as Status]} at <span className="tnum font-medium text-[var(--paper)]">{timerAnchor ? formatTime(timerAnchor, userLocale) : "—"}</span></>
              : "Your shift hasn't started yet."
            : <>{siteName ? `At ${siteName}` : "On shift"} since <span className="tnum font-medium text-[var(--paper)]">{timerAnchor ? formatTime(timerAnchor, userLocale) : "—"}</span></>}
      </p>
    </div>
  );
}
