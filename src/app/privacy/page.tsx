// Privacy Policy stub. The full legal text is not yet written; the public
// consent UI links here from the home page, so a 404 would be a broken
// promise to the user. This stub is intentionally marked DRAFT and should
// be replaced with the real policy reviewed by counsel before launch.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-[var(--paper)]">
      <div className="card-surgical p-8">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-[var(--paper)]">Privacy Policy (DRAFT)</h1>
        <p className="mb-4 text-xs font-mono uppercase tracking-wider text-amber-400 bg-amber-950/20 border border-amber-500/30 p-3 rounded">
          This page is a placeholder. The final Privacy Policy is being
          prepared and has not been published yet.
        </p>
        <h2 className="mt-6 mb-2 text-sm font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">What we collect</h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--paper-dim)]">
          J-Pay processes employee attendance events, site assignments, and
          derived payroll inputs. Location data is captured only at the moment
          of a check-in event and is associated with the employee who
          performed the check-in.
        </p>
        <h2 className="mt-6 mb-2 text-sm font-mono uppercase tracking-wider text-[var(--paper-dimmer)]">Retention</h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--paper-dim)]">
          See the data retention section of the J-Pay technical reference
          document (j-pay.md §6) for retention windows per table.
        </p>
        <p className="mt-8 border-t border-[var(--line)] pt-4 text-xs font-mono text-[var(--paper-dimmer)]">
          Last updated: 2026-09-01. This document is DRAFT and does not
          constitute legal advice. Replace before public launch.
        </p>
      </div>
    </main>
  );
}
