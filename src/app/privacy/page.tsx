// Privacy Policy stub. The full legal text is not yet written; the public
// consent UI links here from the home page, so a 404 would be a broken
// promise to the user. This stub is intentionally marked DRAFT and should
// be replaced with the real policy reviewed by counsel before launch.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-[var(--paper)]">
      <div className="card-surgical p-8">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-[var(--paper)]">Privacy Policy (DRAFT)</h1>
        <p className="mb-4 text-xs font-mono uppercase tracking-wider text-[var(--hivis)] bg-[var(--hivis)]/10 border border-[var(--hivis)]/30 p-3 rounded">
          This page is a placeholder. The final Privacy Policy is being
          prepared and has not been published yet.
        </p>
        <h2 className="mt-6 mb-2 text-sm font-mono uppercase tracking-wider text-[var(--fog)]">What we collect</h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          J-Pay processes employee attendance events, site assignments, and
          derived payroll inputs. Location data is captured at the moment of a
          check-in event and is associated with the employee who performed the
          check-in.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong>Optional travel tracking (off by default).</strong> With your
          explicit consent — a toggle in the check-in screen, stored as
          users.travelConsentAt — J-Pay records coarse GPS fixes while you have
          an open shift and are <em>outside every site you are assigned to</em>.
          Your manager sees your position and travel status only for those
          shifts and sites. No fixes are recorded inside a geofence, outside a
          shift, or without your consent; you can revoke it at any time in the
          check-in screen. Raw route data (path samples) is deleted after the
          retention window; aggregate distance and duration are kept for
          payroll evidence. Tracking runs only while the app is open — J-Pay
          cannot track you with the app closed.
        </p>
        <h2 className="mt-6 mb-2 text-sm font-mono uppercase tracking-wider text-[var(--fog)]">Retention</h2>
        <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          See the data retention section of the J-Pay technical reference
          document (j-pay.md §6) for retention windows per table.
        </p>
        <p className="mt-8 border-t border-[var(--line)] pt-4 text-xs font-mono text-[var(--fog)]">
          Last updated: 2026-09-01. This document is DRAFT and does not
          constitute legal advice. Replace before public launch.
        </p>
      </div>
    </main>
  );
}
