"use client";

import { useRouter } from "next/navigation";

export default function AboutPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4" data-testid="demo-about">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-emerald-300">About this demo</h1>
        <button
          type="button"
          onClick={() => router.push("/demo")}
          className="text-sm text-neutral-400 underline"
        >
          Back to dashboard
        </button>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm leading-relaxed text-neutral-300">
        <p className="mb-2">
          This is a working preview of J-Pay, populated with seeded data so you can
          explore the real product without needing a live deployment.
        </p>
        <p className="mb-2">
          You sign in anonymously — no password, no email — and you act as one of five
          seeded employees. The dashboard shows their 13-day history, derived shifts,
          payroll totals, the audit log, and shifts that the system itself flagged
          for review.
        </p>
        <p className="mb-2">
          Check-ins you make here are attributed to the persona, not to you, so the
          review queue reacts as if a real employee were on site.
        </p>
        <p className="mb-2 font-semibold text-amber-300">
          This is throwaway data, not a real customer. The reviewer row you created
          will be auto-purged after 7 days, along with its demo sessions, logs, and
          messages. The real product is unaffected.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-neutral-100">What this demo is not</h2>
        <ul className="ml-5 list-disc text-sm text-neutral-400">
          <li>It is not a stress test — the seeded corpus is bounded (5 personas × 13 weekday days).</li>
          <li>It is not a multi-tenant preview — each reviewer gets one persona at a time.</li>
          <li>It is not a production data environment — switching personas does not move real payroll data.</li>
        </ul>
      </section>
    </div>
  );
}
