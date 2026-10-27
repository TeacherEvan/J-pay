"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { jpayConfig } from "../../config/jpay.config";

export function KpiBanner() {
  const kpi = useQuery(api.kpi.summary);
  const seed = useAction(api.demo.seedDemoData);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  if (!kpi) return null;
  const hours = Math.round((kpi.weeklyBillableMinutes / 60) * 10) / 10;
  const cards = [
    { label: "Active on site", value: String(kpi.activeOnSite), tone: "text-[var(--mint)]" },
    { label: "Billable hrs (7d)", value: `${hours}h`, tone: "text-sky-400" },
    { label: "Pending reviews", value: String(kpi.pendingReviews), tone: kpi.pendingReviews ? "text-[var(--hivis)]" : "text-[var(--fog)]" },
    { label: "Anomalies (24h)", value: String(kpi.anomalies24h), tone: kpi.anomalies24h ? "text-red-400" : "text-[var(--fog)]" },
  ];
  return (
    <section aria-label="Key metrics" className="tnum grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          aria-label={`${c.label}: ${c.value}`}
          className="card-surgical p-4 transition-all"
        >
          <div className={`tnum text-2xl font-bold tracking-tight ${c.tone}`}>{c.value}</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--fog)]">{c.label}</div>
        </div>
      ))}
      {kpi.demoModeEnabled && (
        <div className="col-span-full flex flex-wrap items-center gap-3 text-xs text-[var(--fog)]">
          <span>Demo mode active for {jpayConfig.client.name}</span>
          <button
            onClick={async () => {
              setSeedMsg("Seeding…");
              try {
                const r = await seed();
                setSeedMsg(
                  `Seeded ${r.sites} sites · ${r.employees} employees · ${r.logsInserted} logs (${r.logsSkippedDuplicates} duplicates skipped)`
                );
              } catch (e) {
                setSeedMsg(`Seed failed: ${String(e).slice(0, 120)}`);
              }
            }}
            className="btn-surgical px-3.5 py-2 text-xs font-semibold text-[var(--mint)] border-[var(--mint)]/40 hover:bg-[var(--mint)]/10"
          >
            Seed investor demo
          </button>
          {seedMsg && <span className="text-[var(--paper)]">{seedMsg}</span>}
        </div>
      )}
    </section>
  );
}
