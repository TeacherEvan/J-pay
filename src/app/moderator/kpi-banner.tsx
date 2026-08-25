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
    { label: "Active on site", value: String(kpi.activeOnSite), tone: "text-emerald-400" },
    { label: "Billable hrs (7d)", value: `${hours}h`, tone: "text-sky-400" },
    { label: "Pending reviews", value: String(kpi.pendingReviews), tone: kpi.pendingReviews ? "text-amber-400" : "text-neutral-300" },
    { label: "Anomalies (24h)", value: String(kpi.anomalies24h), tone: kpi.anomalies24h ? "text-red-400" : "text-neutral-300" },
  ];
  return (
    <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          aria-label={`${c.label}: ${c.value}`}
          className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
        >
          <div className={`text-2xl font-semibold ${c.tone}`}>{c.value}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">{c.label}</div>
        </div>
      ))}
      {kpi.demoModeEnabled && (
        <div className="col-span-full flex flex-wrap items-center gap-3 text-xs text-neutral-500">
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
            className="rounded border border-neutral-700 px-3 py-2.5 text-sm text-emerald-300 hover:bg-neutral-800"
          >
            Seed investor demo
          </button>
          {seedMsg && <span className="text-neutral-400">{seedMsg}</span>}
        </div>
      )}
    </section>
  );
}
