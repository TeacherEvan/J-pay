"use client";

import { useMutation, useQuery } from "@/lib/backend/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/backend/api";
import { errMsg } from "@/lib/errors";

const PERSONAS = [
  {
    email: "thabo.demo@jpay.local",
    name: "Thabo Mokoena",
    narrative: "Clean punctual record at JNB Central Depot — 13 weekday days, no anomalies, no reviews.",
  },
  {
    email: "sipho.demo@jpay.local",
    name: "Sipho Ndlovu",
    narrative: "Side-mission user at JNB — declared 30-45 minute side missions, always closed out with a checkpoint.",
  },
  {
    email: "lerato.demo@jpay.local",
    name: "Lerato Khumalo",
    narrative: "Excessive unpaired lunch at Midrand Distribution Hub — triggers the unpaired_lunch_excessive review flag.",
  },
  {
    email: "david.demo@jpay.local",
    name: "David Miller",
    narrative: "Impossible-travel case: JNB arrival followed by a CPT checkpoint 12 minutes later. Travel flag set.",
  },
  {
    email: "pieter.demo@jpay.local",
    name: "Pieter van der Merwe",
    narrative: "Weak GPS signal and a clock skew of 45s on day 5 — sanity-checks the ±50m geofence and skew tolerance.",
  },
];

export default function PersonaSwitcher() {
  const binding = useQuery(api.demo.getBinding);
  const switchPersona = useMutation(api.demo.switchPersona);
  const router = useRouter();
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function pick(email: string) {
    setBusyEmail(email);
    setMessage(null);
    try {
      await switchPersona({ personaEmail: email });
      router.push("/demo");
    } catch (e) {
      setMessage(errMsg(e));
      setBusyEmail(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="persona-switcher">
      <header className="flex items-baseline justify-between border-b border-[var(--line)] pb-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--mint)]">Switch persona</h1>
        <button
          type="button"
          onClick={() => router.push("/demo")}
          className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-[var(--paper)]"
        >
          ← Back to dashboard
        </button>
      </header>
      <p className="text-xs text-[var(--text-secondary)]">
        Currently acting as <span className="text-[var(--paper)] font-medium">{binding?.personaName ?? "—"}</span>. Pick a persona below — your demo console will update in real time.
      </p>
      <ul className="flex flex-col gap-3">
        {PERSONAS.map((p) => {
          const isCurrent = binding?.personaEmail === p.email;
          return (
            <li
              key={p.email}
              className={`card-surgical flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors ${
                isCurrent
                  ? "border-[var(--mint)]/50 bg-[var(--mint)]/10"
                  : ""
              }`}
              data-testid="persona-row"
            >
              <div>
                <p className="text-sm font-semibold text-[var(--paper)]">{p.name}</p>
                <p className="text-xs font-mono text-[var(--text-secondary)]">{p.email}</p>
                <p className="mt-1 text-xs text-[var(--fog)]">{p.narrative}</p>
              </div>
              <button
                type="button"
                data-loading={busyEmail === p.email}
                aria-busy={busyEmail === p.email}
                onClick={() => void pick(p.email)}
                disabled={busyEmail === p.email || isCurrent}
                className={isCurrent ? "btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider opacity-60 cursor-not-allowed" : "btn-surgical btn-surgical-mint rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"}
                data-testid="persona-play-button"
              >
                <span className="btn-label">{isCurrent ? "Current" : "Play as"}</span>
                <span className="btn-spinner" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {message && <p className="text-xs font-mono text-[var(--danger)]">{message}</p>}
    </div>
  );
}
