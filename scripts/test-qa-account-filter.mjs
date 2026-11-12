/**
 * F3 regression — the QA-account marker must cover every address shape the
 * repo's own scripts create, not just two prefixes.
 *
 * Audit 2026-11-13, F3: `isQaAccount` matched only `e2e.` and `review-emp.`,
 * so `e2e-all-*` (scripts/e2e-all.mjs), `qa.employee.*`
 * (scripts/smoke-supabase.mjs) and `e2e-test@…` passed the filter into the
 * moderator roster, the KPI headcount and broadcast targets.
 *
 * The live project on 2026-11-13 held 14 active `@jpay.local` identities, of
 * which 3 leaked. The rule is therefore anchored on the reserved domain first
 * (`@jpay.local` is test-only), with the legacy local-part shapes kept for
 * anything provisioned outside it.
 */
import assert from "node:assert/strict";

import { isQaAccount } from "../convex/access.ts";

const asUser = (email) => ({ email, name: email, role: "employee", isActive: true });

/* Every shape the repo's scripts produce, plus the live production rows. */
const QA = [
  "e2e.breakglass.tmp@jpay.local",
  "e2e-all-mwdszk13@jpay.local",
  "e2e-all-mwdt2ezv@jpay.local",
  "e2e.mwdt6qbq@jpay.local",
  "e2e-test@jpay.local",
  "e2e-review@jpay.local",
  "qa.employee.abc123@jpay.local",
  "review-emp.abc123@jpay.local",
  "e2e@jpay.local",
  "qa@jpay.local",
  /* legacy shapes provisioned before the reserved domain existed */
  "e2e.someone@example.com",
  "e2e-all-someone@example.com",
  "review-emp.someone@example.com",
  "qa.employee@example.com",
  /* case-insensitivity */
  "E2E.UPPER@JPAY.LOCAL",
];

/* Real accounts that must never be filtered out of a roster or a broadcast. */
const REAL = [
  "ewiebotha@gmail.com",
  "e.botha@rocketmail.com",
  "dewetlot04@gmail.com",
  "ajay@ve.com",
  "e2ebusiness@company.com", // starts with "e2e" but is not a QA shape
  "qatar.office@company.com", // starts with "qa" but is not a QA shape
  "",
];

let failures = 0;
for (const email of QA) {
  if (!isQaAccount(asUser(email))) {
    console.error(`FAIL  not recognised as QA: ${email}`);
    failures += 1;
  }
}
for (const email of REAL) {
  if (isQaAccount(asUser(email))) {
    console.error(`FAIL  real account treated as QA: ${JSON.stringify(email)}`);
    failures += 1;
  }
}
assert.equal(isQaAccount({ name: "no email", role: "employee", isActive: true }), false,
  "a user without an email is not QA");

if (failures > 0) {
  console.error(`\n${failures} address(es) misclassified`);
  process.exit(1);
}
console.log(`qa-account filter: ${QA.length} QA shapes + ${REAL.length} real shapes correct`);
