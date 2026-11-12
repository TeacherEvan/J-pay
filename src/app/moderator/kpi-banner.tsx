"use client";

import { useQuery } from "@/lib/backend/react";
import { api } from "@/lib/backend/api";

export function KpiBanner() {
  const kpi = useQuery(api.kpi.summary);
  if (!kpi) {
    // Reserved-bounds skeleton — no layout pop when the query lands (CLS = 0).
    return (
      <div aria-hidden="true" className="tnum grid flex-none grid-cols-4 gap-1.5 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-surgical h-[4.5rem] animate-pulse opacity-50 sm:h-20" />
        ))}
      </div>
    );
  }
  const hours = Math.round((kpi.weeklyBillableMinutes / 60) * 10) / 10;
  const cards = [
    { label: "Active on site", value: String(kpi.activeOnSite), tone: "text-[var(--mint)]" },
    { label: "Billable hrs (7d)", value: `${hours}h`, tone: "text-[var(--cyan)]" },
    { label: "Pending reviews", value: String(kpi.pendingReviews), tone: kpi.pendingReviews ? "text-[var(--hivis)]" : "text-[var(--fog)]" },
    { label: "Anomalies (24h)", value: String(kpi.anomalies24h), tone: kpi.anomalies24h ? "text-[var(--danger)]" : "text-[var(--fog)]" },
  ];
  return (
    <section aria-label="Key metrics" className="tnum grid flex-none grid-cols-4 gap-1.5 sm:gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          aria-label={`${c.label}: ${c.value}`}
          className="card-surgical flex-none p-3 transition-colors sm:p-4"
        >
          <div className={`tnum text-2xl font-bold tracking-tight ${c.tone}`}>{c.value}</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">{c.label}</div>
        </div>
      ))}
    </section>
  );
}
