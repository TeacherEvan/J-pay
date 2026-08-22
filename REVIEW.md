# J-Pay TRD v0.2 — Review

**Reviewer:** ox-alpha · **Date:** 2026-08-23 · **Target:** `j-pay.md` (Draft v0.2)
**Method:** live registry/docs verification (npm registry, serwist.pages.dev) + architectural read.

---

## Verdict

Solid corrected draft. The five structural gaps it claims to close are genuinely closed, and its riskiest external claims **verify against live sources**:

| Claim in TRD | Verified |
|---|---|
| `next-pwa` unmaintained | ✅ last publish **v5.6.0, Aug 2022** (npm registry) |
| Serwist actively supported | ✅ `@serwist/next` **v9.5.12, Jul 2026**, App Router docs current |
| Convex doc cap 1 MB | ✅ matches Convex documented limit |
| Vercel 10s / 4.5MB function bounds | ✅ correct scope (serverless routes only) |

One nuance the doc misses: Serwist's standard `@serwist/next` integration is **webpack-based**; Turbopack builds need Serwist's separate Turbopack guide / configurator mode. If the project builds with Turbopack (increasingly the Next default), §2 must pin this decision.

---

## Findings

### F1 — Push schema is underspecified (Medium)
`users.pushSubscriptionTokens: string[]` cannot hold a real Web Push subscription (endpoint URL + `p256dh` + `auth` keys, JSON per browser/device). Use a dedicated `pushSubscriptions` table (`userId`, `deviceId`, `endpoint`, `keys`, `expirationTime`). Also add unsubscribe pruning — dead endpoints accumulate fast.

### F2 — Tamper-delta conflates clock skew with network latency (Medium)
§4.3 computes `Delta = clientReportedTime − _creationTime`. `_creationTime` includes round-trip latency, so honest clients on bad mobile networks will trip the flag. Define a threshold band (e.g. flag only beyond ±120s). More important: **offline-replayed check-ins** (§4.6) get `_creationTime` hours after the event — they must be tagged `OFFLINE_REPLAY` at reconcile time and excluded from tamper scoring, otherwise the offline feature manufactures false fraud flags.

### F3 — Background Sync is not a reliable flush mechanism alone (High, mobile reality)
Background Sync (and worse, `periodicSync`) has patchy support — notably **iOS Safari limitations**. The offline queue must also flush on (a) app foregrounding, (b) `online` event, (c) next successful mutation, with SW Background Sync as a bonus path. §4.3's diagram implies SW-only retry; make foreground reconciliation the primary path.

### F4 — Install button is Android/desktop-only (Medium)
`beforeinstallprompt` does **not exist on iOS Safari**. The "Install J-Pay" custom button (§5.1) silently never appears for iPhone employees. Add platform detection → show manual "Share → Add to Home Screen" instructions on iOS. This matters because field workforce is likely heavily iOS in ZA.

### F5 — Device binding is client-asserted (Medium, honesty about threat model)
A spoofed `deviceId` in the mutation args defeats `DEVICE_MISMATCH` entirely. Fine as a soft control, but the TRD should say so: treat device binding as audit signal, not authentication. Real binding needs attestation or at minimum a server-issued device token set at activation and stored outside localStorage.

### F6 — Push architecture can be simplified (Low)
"Convex cannot send Web Push" is true of the platform, but a **Convex Action running the `web-push` npm package** dispatches notifications directly — no Vercel Function hop required. Keeping VAPID private keys in Convex env removes one deployment surface and one L3 concern. Either justify the Vercel Function (e.g. shared sender with other systems) or drop it.

### F7 — ERD drift vs body text (Low, consistency)
- §6.2 references `users.timezone` — absent from the §4.2 ERD. Add it.
- `sideMissionDurationMinutes enum` typed as enum but values `15|30|45|60|120` are numbers; name it accordingly (`sideMissionMinutes`).
- `MESSAGES.recipientId "optional = mod queue"` — mod-queue semantics undefined; model the queue explicitly or explain null-routing.
- No `payrollConfig` home for §5.3's editable rates/multipliers/overtime/currency/rounding — currently floats free of the schema.
- First-moderator bootstrap: §4.4 says moderators are created only by existing moderators — chicken-and-egg. Specify a one-time env-keyed bootstrap mutation or CLI seed.

### F8 — Multi-tenancy is Q1 but shapes everything (Process)
Schema isolation, auth, geofence defaults, and CSV export all fork on this answer. Recommend promoting it to a blocking precondition before any schema code lands.

---

## Minor notes
- L4's 50MB precache budget is generous for an app shell; consider a tighter internal target (~10–15MB) so the CI gate catches rot before hitting the ceiling.
- §6.5's two export options are both viable; pick the Convex-action → storage signed-URL variant now to avoid designing for both.
- Footer disclaimer is fair; the Serwist/Turbopack point above is the one place the "validate at implementation" caveat bites hardest today.

## Recommendation
Approve direction. Fix F3, F4 (mobile-platform realities) and F7 (schema drift) before implementation start; F1/F2 during first schema pass; F6 is an optional simplification.

*An ounce of prevention is worth a pound of cure — resolve Q1 before writing `convex/schema.ts`.*
