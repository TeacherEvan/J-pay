# J-Pay TRD v1.1 — Senior Review

**Reviewer:** ox-alpha · **Date:** 2026-08-23 · **Target:** `doc_52fa6595ff2f_j-pay.md` (v1.1)
**Method:** live verification (npm registry, docs.convex.dev, serwist.pages.dev, vercel.com/docs, caniuse.com, nextjs.org) + architectural read. Supersedes my earlier review of v0.2.
**Second pass (same date):** every load-bearing claim re-probed against live sources; two corrections applied (see §Corrections).

---

## Corrections from second pass (2026-08-23)

| I said | Live probe shows | Action |
|---|---|---|
| Vercel "10s execution" is a hard limit to design around (accepted §3.3 as-is) | Vercel's current Fluid compute: **300s default/max Hobby, 800s Pro, 1800s extended**; the 10s figure is the *legacy* serverless default. The 4.5MB payload cap IS current and verified verbatim (`413 FUNCTION_PAYLOAD_TOO_LARGE`) | TRD §3.3 should be rewritten: only the 4.5MB body cap binds; duration limits are configurable, near-moot for this app |
| Background Sync is "patchy — notably iOS Safari limitations" | caniuse: Background Sync has **zero Safari support of any version ever** (desktop Safari ❌ 3.1–26.6, iOS Safari ❌ all). Chrome/Edge/Samsung only | Escalates my F3 point from "iOS gap" to "no Apple device will ever fire your sync event." Foreground/`online` reconciliation isn't a fallback — it is the ONLY path for ~half a typical ZA field workforce |
| TRD targets Next.js 15 | `next` latest is **16.3.2** (2026-08-21); `@serwist/next@9.5.12` peerDeps accept `next >=14`, so Serwist won't block a 16 upgrade | TRD should either pin Next 15 deliberately or move to 16; silently targeting last-major is how stacks rot before launch |

Everything else re-probed clean: Convex 1 MiB/doc + 16 MiB transaction limits (docs.convex.dev/production/state/limits), `<ConvexProviderWithClerk>` documented verbatim with `ConvexReactClient(NEXT_PUBLIC_CONVEX_URL)` (docs.convex.dev/auth/clerk), native cron via `crons.ts` (docs.convex.dev/scheduling/cron-jobs), `.order("asc"\|"desc")` for previous-fix lookups (docs.convex.dev/database/reading-data), next-pwa dead since 2022-08-23 (npm), Serwist current 2026-07-22 (npm).

## Verdict

**Approve with conditions.** This is a materially stronger document than v0.2: every one of my prior findings is addressed (push subscription table F1, skew-band thinking F2, replay-ordering F3, iOS install F4, device-token honesty F3/F5, schema drift F7). The revision log is honest and the conflict rule (§1.1 — schema wins) is good engineering hygiene.

Live checks pass:
- Convex doc size limit verified: **1 MiB per document** (docs.convex.dev/production/state/limits) — §3's wording "transaction limit" is loose; see M2.
- Clerk integration path exists and is first-class in Convex docs.
- Convex has native cron (`crons.ts`, `cronJobs()`) — relevant to R9, see M4.

---

## Blocking issues (fix before implementation)

### B1 — "All Convex access flows through Next.js route handlers" contradicts the reactive-query requirement
§2 mandates routing every Convex call through Vercel route handlers/server components. But §5.2 requires **real-time audit** via "Convex reactive queries," and §8's offline replay works best with the standard client. Proxying everything through route handlers **destroys reactivity**: a route handler returns once; there are no live subscriptions over your own HTTP layer. You would have to build polling to fake what `useQuery` gives for free.

The standard, supported pattern (verified in Convex docs): `<ConvexProviderWithClerk>` on the client with the **public** `NEXT_PUBLIC_CONVEX_URL` plus Clerk JWT auth. This does not leak data — every query/mutation enforces row-scoped authz server-side (your own R4). The `CLERK_ISSUER` check happens inside Convex's `auth` config, not at the URL layer.

**Fix:** rewrite §2 deployment row. Client talks to Convex directly for queries/mutations (authenticated via Clerk JWT); route handlers exist only where you need Vercel-side secrets or work (device token issuer, CSV export assembly if kept on Vercel).

### B2 — Shift state machine vs side-mission substate is under-specified to implement
§10.5's state diagram omits `quick_side_mission` entirely, while §5.1/§6.1 make it legal from any active state with an exit condition. Also unresolved mechanically:
- What happens on `lunch` *while inside* a side mission? Legal? Auto-exit?
- Does `day finish`/`job finish` implicitly exit an open side mission?
- Is the picker duration authoritative, or actual elapsed wall-clock between entry/exit (whichever smaller)? Payroll disputes will land exactly here.
- Rule 4 (unpaired lunch deducts default 60min) conflicts in spirit with "out-of-grammar → needsReview." Why does an unpaired lunch get silently deducted but an unpaired side mission doesn't get a parallel rule?

**Fix:** extend §10.5 with the substate, add explicit answers to the four questions above, and give unpaired side missions the same treatment as unpaired lunches (deduct declared duration, needsReview only past 2× threshold).

### B3 — `clockSkewMs` index claimed but not present in the schema
§7 says moderators filter `|skew| > 30000ms` "via that index rather than post-query scans" (R11), but `logs` has no such index — only `by_user_time`, `by_status`, `by_site_time`. Convex indexes are ascending-field ranges; you cannot range-scan on absolute value anyway. Practical fix: add `.index("by_user_skew", ["userId", "clockSkewMs"])` and query both tails (`skew ≤ −30000`, `skew ≥ 30000`), or drop the "indexable" claim and accept filtered scans within a user's date window (fine at this scale).

---

## Medium issues

### M1 — Impossible-travel check has no defined storage of "previous fix"
R8 compares against "the employee's previous fix" but the schema stores no ordering key that makes that lookup cheap across offline replay. Previous-fix-by-server-time is wrong after replays (§8 itself proves it); previous-by-skew-corrected-client-time requires a query sorted on a non-indexed derived value. Define it: query `by_user_time` descending, take latest N (say 5), pick max `clientReportedTime`. Flag-only semantics make approximation acceptable — just say so.

### M2 — Limit wording precision (minor but this is a TRD)
Convex's verified limits: **1 MiB per document/nested object**, and separately **16 MiB written / 16 MiB read per transaction**. §3 item 2 says "payloads must not exceed the 1MB transaction limit" — wrong term, right instinct. Outbox replay batches (§8.4) are bounded by transaction limits, not document limits; a batch of small logs can legally exceed nothing here. Reword: each log ≪ 1 MiB per doc; replay batch ≤ sensible fraction of 16 MiB write budget.

### M3 — Retention purge vs soft-delete tension
§9 purges raw coords on schedule, but §6 `logs.archivedAt` was dropped in favor of... no archived field on logs at all (only users/sites/messages have it). After coordinate purge, the log row keeps status/time but loses its evidence value for payroll disputes. Decide and document: anonymize (zero out lat/lng, keep row) vs delete row entirely, and whether payroll-finalized periods are exempt until dispute windows close.

### M4 — R9 says "Vercel Cron → Convex purge mutation"
Works, but Convex has **native scheduled functions** (`convex/crons.ts`, verified live) which remove the external dependency and run even if Vercel cron misfires. Simpler ops surface, one less cross-platform failure mode. Either justify Vercel Cron (e.g., you already centralize scheduling there) or switch.

### M5 — Device token issuance lives on Vercel but verification lives in Convex
The HMAC secret must then exist in **both** Vercel env and Convex env — two secret surfaces for the same credential. Alternative: issue the device token inside a Convex action/internal mutation at activation time (secret only in Convex env). If Vercel issuance is deliberate (e.g., rate-limiting at edge), document why.

### M6 — `sites` table lacks creator/audit fields
Moderator-provisioned sites with no `createdBy`/`updatedBy` audit trail will bite during payroll disputes ("who moved the geofence?"). Cheap to add now, painful later. Consider a tiny `siteHistory` append-log if disputes are common.

### M7 — Push send path unspecified
v1.1 fixed pruning (R12) and the subscription table, but *who sends* remains undefined — Clerk+Convex+Vercel stack still has no Web Push sender named. Same gap I flagged in v0.2 (a Convex Action running `web-push` with keys in Convex env is the simplest answer). One paragraph closes it.

---

## Minor / notes
- §3.1 accuracy gate: `accuracyMeters > 50` hard-reject may starve dense urban canyons; consider escalating thresholds after N consecutive rejects before falling back to moderator override. (Override exists, so this is UX polish.)
- `messages.retentionDays` appears in schema but nowhere in §9 policy text — wire them together or drop it.
- `users.hourlyRateOverride` implies site/base rates elsewhere; §5.2 says "editable hourly rates and multipliers" but no multiplier fields exist in schema. Add `payrollConfig` table or user-level multipliers, else §5.2 over-promises.
- ERD (§10.2) omits `logs.idempotencyKey`, `impossibleTravelFlag`, `isModeratorOverride`, `sites.timezone`, `shifts.reviewReason` — §1.1 says schema wins, fine, but sync the diagram since it's the reviewer's map.
- Open Question 3 (multi-site geofence-active) also gates `userSites` uniqueness — add a unique-composite note now.

## Recommendation
Conditions to clear before code: B1 (architecture contradiction — biggest one), B2 (state machine completion), B3 (skew index honesty). M1/M5/M7 in the first schema pass. Everything else can ride normal iteration.

**Second-pass escalations:** the Background Sync finding is now a fourth blocker — on Safari/iOS (all versions) it never fires, so §8's replay path must be re-architected around foreground reconciliation as primary. And §3.3's "10s" Vercel duration figure should be corrected to the current Fluid compute reality (300s+ configurable); only the 4.5MB payload cap binds as stated.

*Well begun is half done — but only if the architecture section stops contradicting the features section.*
