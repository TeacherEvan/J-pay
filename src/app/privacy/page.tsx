// Privacy Policy stub. The full legal text is not yet written; the public
// consent UI links here from the home page, so a 404 would be a broken
// promise to the user. This stub is intentionally marked DRAFT and should
// be replaced with the real policy reviewed by counsel before launch.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-neutral-200">
      <h1 className="mb-4 text-2xl font-semibold">Privacy Policy (DRAFT)</h1>
      <p className="mb-3 text-sm leading-relaxed text-neutral-400">
        This page is a placeholder. The final Privacy Policy is being
        prepared and has not been published yet.
      </p>
      <h2 className="mt-6 mb-2 text-lg font-medium">What we collect</h2>
      <p className="mb-3 text-sm leading-relaxed text-neutral-400">
        J-Pay processes employee attendance events, site assignments, and
        derived payroll inputs. Location data is captured only at the moment
        of a check-in event and is associated with the employee who
        performed the check-in.
      </p>
      <h2 className="mt-6 mb-2 text-lg font-medium">Retention</h2>
      <p className="mb-3 text-sm leading-relaxed text-neutral-400">
        See the data retention section of the J-Pay technical reference
        document (j-pay.md §6) for retention windows per table.
      </p>
      <p className="mt-8 text-xs text-neutral-500">
        Last updated: 2026-09-01. This document is DRAFT and does not
        constitute legal advice. Replace before public launch.
      </p>
    </main>
  );
}
