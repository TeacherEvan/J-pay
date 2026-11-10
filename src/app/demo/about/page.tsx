"use client";

import { useRouter } from "next/navigation";

export default function AboutPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4" data-testid="demo-about">
      <header className="flex items-baseline justify-between border-b border-[var(--line)] pb-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--mint)]">About this demo</h1>
        <button
          type="button"
          onClick={() => router.push("/demo")}
          className="btn-surgical rounded px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-[var(--paper)]"
        >
          ← Back to dashboard
        </button>
      </header>

      <section className="card-surgical p-5 text-sm leading-relaxed text-[var(--text-secondary)]">
        <p className="mb-3 text-[var(--paper)]">
          This is a working preview of J-Pay, populated with seeded data so you can
          explore the real product without needing a live deployment.
        </p>
        <p className="mb-3">
          You sign in anonymously — no password, no email — and you act as one of five
          seeded employees. The dashboard shows their 13-day history, derived shifts,
          payroll totals, the audit log, and shifts that the system itself flagged
          for review.
        </p>
        <p className="mb-3">
          Check-ins you make here are attributed to the persona, not to you, so the
          review queue reacts as if a real employee were on site.
        </p>
        <p className="border-l-2 border-[var(--hivis)] pl-3 py-1 font-medium text-[var(--hivis)] bg-[var(--hivis)]/10 rounded-r">
          This is throwaway data, not a real customer. The reviewer row you created
          will be auto-purged after 7 days, along with its demo sessions, logs, and
          messages. The real product is unaffected.
        </p>
      </section>

      <section className="card-surgical p-5 text-sm">
        <h2 className="mb-2 text-xs font-mono uppercase tracking-wider text-[var(--fog)]">What this demo is not</h2>
        <ul className="ml-5 list-disc space-y-1 text-xs text-[var(--text-secondary)]">
          <li>It is not a stress test — the seeded corpus is bounded (5 personas × 13 weekday days).</li>
          <li>It is not a multi-tenant preview — each reviewer gets one persona at a time.</li>
          <li>It is not a production data environment — switching personas does not move real payroll data.</li>
        </ul>
      </section>
    </div>
  );
}
