"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
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
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-emerald-300">Switch persona</h1>
        <button
          type="button"
          onClick={() => router.push("/demo")}
          className="text-sm text-neutral-400 underline"
        >
          Back to dashboard
        </button>
      </header>
      <p className="text-sm text-neutral-400">
        Currently acting as <span className="text-neutral-200">{binding?.personaName ?? "—"}</span>. Pick a persona below — your demo console will update in real time.
      </p>
      <ul className="flex flex-col gap-3">
        {PERSONAS.map((p) => (
          <li
            key={p.email}
            className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
              binding?.personaEmail === p.email
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-neutral-800 bg-neutral-900/40"
            }`}
            data-testid="persona-row"
          >
            <div>
              <p className="text-sm font-semibold text-neutral-100">{p.name}</p>
              <p className="text-sm text-neutral-500">{p.email}</p>
              <p className="mt-1 text-sm text-neutral-400">{p.narrative}</p>
            </div>
            <button
              type="button"
              onClick={() => void pick(p.email)}
              disabled={busyEmail === p.email || binding?.personaEmail === p.email}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
              data-testid="persona-play-button"
            >
              {binding?.personaEmail === p.email
                ? "Current"
                : busyEmail === p.email
                ? "Switching…"
                : "Play as"}
            </button>
          </li>
        ))}
      </ul>
      {message && <p className="text-sm text-red-400">{message}</p>}
    </div>
  );
}
