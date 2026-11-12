# Change-My-Password Error UX Hardening

> **For Hermes/Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Verify each gate against the live tree before marking a step done.

**Goal:** Replace the uncaught `Error: InvalidSecret` 500 from `api.users.changeMyPassword` with a typed `INVALID_CURRENT_PASSWORD` response (and `TOO_MANY_ATTEMPTS` once the upstream rate limiter trips) so the employee settings page can show a real inline error instead of a generic server-error toast.

**Architecture:** Wrap the upstream `retrieveAccount` call so we read its typed return shape directly (`"InvalidAccountId" | "TooManyFailedAttempts" | "InvalidSecret" | {...}`) instead of letting the `@convex-dev/auth` high-level wrapper rethrow the string result as a plain `Error`. Map the three failure strings to `ConvexError` codes the client already handles. The frontend `PasswordFields` component already calls `errMsg(e)`; we add a small typed-error mapper so a wrong current password renders "Current password / ID code is incorrect" and a rate-limit renders "Too many attempts. Try again in a minute." No schema changes; no new tables; no new auth surface.

**Tech Stack:** Convex actions (`convex/users.ts`), `@convex-dev/auth@0.0.95` (already installed), `ConvexError` (already imported), `src/lib/errors.ts` (already exists).

**Effort:** ~2 hours | **Surfaces touched:** 2 files (`convex/users.ts`, `src/lib/errors.ts`), 1 new test file (`scripts/test-change-password-errors.mjs`) | **New tables:** 0 | **Feature flag:** none (always-on)

---

## Verified facts (probed, not remembered)

| Claim | Probe | Result |
|---|---|---|
| `retrieveAccount` (high-level) rethrows string results as `Error` | `node_modules/@convex-dev/auth/dist/server/implementation/index.js:373-381` | ✅ confirmed: `if (typeof result === "string") { throw new Error(result); }` |
| Underlying return type is `"InvalidAccountId" \| "TooManyFailedAttempts" \| "InvalidSecret" \| {account, user}` | `node_modules/@convex-dev/auth/dist/server/implementation/mutations/retrieveAccountWithCredentials.d.ts:20` | ✅ confirmed |
| `isSignInRateLimited` + `recordFailedSignIn` are enforced inside `retrieveAccountWithCredentialsImpl` | `node_modules/@convex-dev/auth/dist/server/implementation/mutations/retrieveAccountWithCredentials.js:14-31` | ✅ confirmed (rate limit is automatic; we do NOT add our own) |
| `modifyAccountCredentials` does NOT rate-limit (it just patches the hash) | `node_modules/@convex-dev/auth/dist/server/implementation/mutations/modifyAccount.js:8-26` | ✅ confirmed — only `retrieveAccount` path is rate-limited |
| Current live `changeMyPassword` at `convex/users.ts:192-213` calls `retrieveAccount` and treats a return value as success | read_file | ✅ confirmed; wrong current secret → uncaught `Error: InvalidSecret` |
| Frontend `src/lib/errors.ts` returns the raw `Error.message`; `PasswordFields` already calls `errMsg(e)` | read_file | ✅ confirmed — adding a typed mapper is a 1-line dispatch |
| Gates baseline: `python3 scripts/check_consistency.py`, `python3 scripts/check_diagrams.py`, `npm test`, `npm run typecheck` all green | terminal | ✅ all pass before changes |
| `npx convex dev --once` is clean (14:55:33 functions ready) | terminal | ✅ no upstream or type errors in current state |

---

## Why this is necessary (evidence trail)

1. **User-reported error** (`docs/UserReview/Error CONVEX A users changeMyPassword.txt`):
   `[CONVEX A(users:changeMyPassword)] Server Error Uncaught Error: InvalidSecret at retrieveAccount (../../node_modules/@convex-dev/auth/src/server/implementation/index.ts:602:9) at async handler (../convex/users.ts:150:6)`
   — line 150 in the user's stack is roughly line 202 today (the same `retrieveAccount` call). The error is reproducible and the surface (server error 500) leaks the upstream library's internal name.

2. **Root cause (verified against installed code):** `retrieveAccount` (high-level) does `if (typeof result === "string") { throw new Error(result); }`. A bad current secret returns `"InvalidSecret"`, which becomes `Error("InvalidSecret")` and surfaces uncaught.

3. **Why now:** the new employee can hit this on the very first attempt to replace the moderator-issued one-time code (the `ForcedPasswordChange` modal at `src/app/change-password.tsx:73-97`). The whole onboarding loop is broken on a typo — exactly the wrong place to fail loudly.

---

## Data Flow

### Today (broken)

```
Browser (PasswordFields)            Convex action                  @convex-dev/auth
  |                                    |                                 |
  |  useAction(changeMyPassword)       |                                 |
  |  { currentSecret, newSecret }  --> |                                 |
  |                                    |  retrieveAccount({...})  -----> |
  |                                    |                                 |  verifySecret(s)
  |                                    |                                 |  -> returns "InvalidSecret"
  |                                    |  <----- Error("InvalidSecret")--|
  |                                    |  (string rethrown as Error)     |
  |  <---- Uncaught Error --------------                                 |
  |  errMsg -> "InvalidSecret"                                          |
  |  (leaks upstream name; same shape as a 500)                         |
```

### After (typed)

```
Browser (PasswordFields)            Convex action                  @convex-dev/auth
  |                                    |                                 |
  |  useAction(changeMyPassword)       |                                 |
  |  { currentSecret, newSecret }  --> |                                 |
  |                                    |  runMutation internal          |
  |                                    |  auth:store                    |
  |                                    |  retrieveAccountWithCredentials|
  |                                    |  -> "InvalidAccountId" |       |
  |                                    |     "TooManyFailedAttempts" |  |
  |                                    |     "InvalidSecret" |          |
  |                                    |     { account, user }          |
  |                                    |                                 |
  |                                    |  branch on result:             |
  |                                    |  string -> throw ConvexError    |
  |                                    |  object  -> proceed             |
  |  <---- ConvexError "INVALID_CURRENT_PASSWORD" / "TOO_MANY_ATTEMPTS"   |
  |  errMsg -> "Current password / ID code is incorrect."                |
```

The only library boundary that changes: we call the internal mutation `auth:store` with `type: "retrieveAccountWithCredentials"` directly, instead of the high-level `retrieveAccount` wrapper. The rate limiter is preserved automatically because it lives inside that mutation, not in the wrapper.

---

## Milestone Timeline

Ship in two slices. Slice 1 is invisible (action throws typed codes; client still shows raw text). Slice 2 is the user-visible fix.

### Milestone 1: Backend typed errors (no UI change)

- `convex/users.ts` — bypass `retrieveAccount`; read the typed return via `ctx.runMutation(internal.auth.store.retrieveAccountWithCredentials, ...)` directly, map the three string results to `ConvexError` codes.
- Add `scripts/test-change-password-errors.mjs` exercising: wrong current secret → typed error; missing account → typed error; correct secret → success path stub.

### Milestone 2: Frontend message mapping

- `src/lib/errors.ts` — extend `errMsg` (or add `errMsgFor("changeMyPassword", e)`) to map `INVALID_CURRENT_PASSWORD` → "Current password / ID code is incorrect." and `TOO_MANY_ATTEMPTS` → "Too many attempts. Try again in a minute."
- `src/app/change-password.tsx` — call the mapper; do not change layout or copy elsewhere.

Both slices land behind a single scoped commit; nothing is user-visible until Milestone 2 lands.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Internal mutation path changes in a future `@convex-dev/auth` minor | Low | High | Pin to `^0.0.95` (already done); add a comment near the call site naming the source file so a future upgrade flags the call |
| Bypassing `retrieveAccount` wrapper also bypasses its `maybeRedact` log redaction | Low | Low | The action's own log line uses the wrapper's debug output already; we add no new log surface |
| Rate-limit response ("TooManyFailedAttempts") becomes string-typed in a future version | Low | Medium | The default fallback in our mapper is "Incorrect current password or rate limit. Try again." — degrades gracefully |
| Forgot to also fix `resetPasswordBreakGlass` (same shape) | Medium | Low | Out of scope for this plan (uses same upstream call, same risk; tracked as Tech Debt) |

---

## Test Strategy

**Gate (per milestone, in this order):**

1. `python3 scripts/check_consistency.py` — TRD drift
2. `python3 scripts/check_diagrams.py` — mermaid structural
3. `npm test` — existing shift-engine + CSV guard (must still pass)
4. `npm run typecheck` — `tsc --noEmit` over app + convex
5. `timeout 110 npx convex dev` — Convex function check (catches circular-inference + index-rule errors the local tsc misses)
6. New unit test for the action's error mapping (Milestone 1) and the frontend mapper (Milestone 2)
7. Manual smoke: sign in as the one-time-code user and try a wrong + a right current secret

---

## Task 1: Add typed-error test for the action (RED)

**Files:**
- Create: `scripts/test-change-password-errors.mjs`

**Step 1: Write the failing test**

The test stubs the auth boundary by spinning up an isolated `convex-test` sandbox, provisions a user, and calls a thin exported wrapper that mirrors the new shape. The wrapper is `changeMyPasswordWithTypedErrors` — the same handler with the typed-error branch exposed for testing. For Milestone 1 we test the branch directly without the network: a function `mapRetrieveResult(result)` exported from `convex/users.ts` that takes the upstream return value and returns either a `ConvexError` to throw or `null` to mean "proceed".

```js
// scripts/test-change-password-errors.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

// Import the mapper from a shared module the action uses.
// Until the import exists, this test will fail at module resolution (RED).
import { mapRetrieveResult } from "../convex/_generated/test-only.mjs";

test("mapRetrieveResult: InvalidSecret -> INVALID_CURRENT_PASSWORD", () => {
  const err = mapRetrieveResult("InvalidSecret");
  assert.ok(err instanceof Error);
  assert.equal(err.data, "INVALID_CURRENT_PASSWORD");
});

test("mapRetrieveResult: TooManyFailedAttempts -> TOO_MANY_ATTEMPTS", () => {
  const err = mapRetrieveResult("TooManyFailedAttempts");
  assert.ok(err instanceof Error);
  assert.equal(err.data, "TOO_MANY_ATTEMPTS");
});

test("mapRetrieveResult: InvalidAccountId -> ACCOUNT_NOT_FOUND", () => {
  const err = mapRetrieveResult("InvalidAccountId");
  assert.ok(err instanceof Error);
  assert.equal(err.data, "ACCOUNT_NOT_FOUND");
});

test("mapRetrieveResult: object result -> null (proceed)", () => {
  const result = mapRetrieveResult({ account: { _id: "x" }, user: { _id: "y" } });
  assert.equal(result, null);
});
```

**Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --no-warnings --import ./scripts/register-ts-ext.mjs --test scripts/test-change-password-errors.mjs`
Expected: FAIL with `Cannot find module '../convex/_generated/test-only.mjs'`.

**Step 3: Implement the mapper**

Create `convex/_generated/test-only.mjs` exporting `mapRetrieveResult`. Place the actual mapping function in a NEW file `convex/changePassword.ts` so the action and the test both import from one place:

```ts
// convex/changePassword.ts
import { ConvexError } from "convex/values";

export type RetrieveResult =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: unknown; user: unknown };

export function mapRetrieveResult(result: RetrieveResult): ConvexError<"ACCOUNT_NOT_FOUND" | "TOO_MANY_ATTEMPTS" | "INVALID_CURRENT_PASSWORD"> | null {
  if (typeof result === "string") {
    if (result === "InvalidSecret") return new ConvexError("INVALID_CURRENT_PASSWORD");
    if (result === "TooManyFailedAttempts") return new ConvexError("TOO_MANY_ATTEMPTS");
    if (result === "InvalidAccountId") return new ConvexError("ACCOUNT_NOT_FOUND");
  }
  return null;
}
```

And a re-export shim `convex/_generated/test-only.mjs`:

```js
// Mirrors the .ts shape so node --experimental-strip-types can import it.
export { mapRetrieveResult } from "../changePassword.ts";
```

**Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --no-warnings --import ./scripts/register-ts-ext.mjs --test scripts/test-change-password-errors.mjs`
Expected: 4 passing.

**Step 5: Wire the test into `npm test`**

Edit `package.json` scripts.test to append `scripts/test-change-password-errors.mjs` to the list. Run `npm test` and confirm 31 passing (27 prior + 4 new).

**Step 6: Commit**

```bash
git add convex/changePassword.ts convex/_generated/test-only.mjs scripts/test-change-password-errors.mjs package.json
git commit -m "test(j-pay): typed-error mapper for changeMyPassword upstream return shape"
```

---

## Task 2: Replace `retrieveAccount` call in the action (GREEN)

**Files:**
- Modify: `convex/users.ts:202-208` (the `changeMyPassword` action body)

**Step 1: Write the new call site**

Replace the `await retrieveAccount(ctx, { provider: "password", account: { id: user.email, secret: args.currentSecret } })` line with a direct call to the internal mutation, then branch on the result using the mapper.

```ts
// In convex/users.ts, changeMyPassword action body:
const result = await ctx.runMutation(
  // The internal auth:store mutation is the only public way to invoke
  // retrieveAccountWithCredentials with its typed return shape.
  // Source: node_modules/@convex-dev/auth/dist/server/implementation/mutations/index.js
  // Bypassing the high-level `retrieveAccount` wrapper avoids
  // `if (typeof result === "string") throw new Error(result)`.
  // Track if @convex-dev/auth minor bumps: this internal path is a private contract.
  "auth:store" as never,
  {
    type: "retrieveAccountWithCredentials",
    provider: "password",
    account: { id: user.email, secret: args.currentSecret },
  } as never,
);
const failure = mapRetrieveResult(result as never);
if (failure) throw failure;
```

(The `as never` casts avoid a circular import through `_generated/api`. The string literal `"auth:store"` is the mutation name; the `internal.*` reference cannot be used here because it would require importing `_generated/api` which is forbidden inside the action's own file in this layout. We have already used the same pattern at `convex/users.ts:36-39` for `createAccount`.)

**Step 2: Run gates**

```
python3 scripts/check_consistency.py && python3 scripts/check_diagrams.py
npm test
npm run typecheck
timeout 110 npx convex dev
```

Expected: all green.

**Step 3: Manual reproduction**

In a browser at `localhost:3000` (or run `JPAY_EMAIL=... JPAY_PASSWORD=... npm run e2e` for the full path), go through `ForcedPasswordChange` with a wrong current secret. Expect the new message in the existing `<p className="text-center text-sm">` slot.

**Step 4: Commit**

```bash
git add convex/users.ts
git commit -m "fix(j-pay): typed INVALID_CURRENT_PASSWORD on wrong current secret (no upstream 500)"
```

---

## Task 3: Frontend message mapping

**Files:**
- Modify: `src/lib/errors.ts`
- Modify: `src/app/change-password.tsx:36`

**Step 1: Extend `errMsg` for known codes**

```ts
// src/lib/errors.ts
const TYPED_MESSAGES: Record<string, string> = {
  INVALID_CURRENT_PASSWORD: "Current password / ID code is incorrect.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Try again in a minute.",
  ACCOUNT_NOT_FOUND: "Account not found. Ask your moderator to re-provision you.",
};

export function errMsg(e: unknown): string {
  // ConvexError surfaces the code in `e.data`; plain Errors in `e.message`.
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string" && TYPED_MESSAGES[data]) return TYPED_MESSAGES[data];
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Uncaught Error: /, "");
}
```

**Step 2: No caller change required**

`PasswordFields.submit` already does `setMsg(errMsg(e))` (`src/app/change-password.tsx:36`). The mapper activates automatically.

**Step 3: Add a unit test (Vitest) for the mapper**

Create `src/lib/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { errMsg } from "./errors";

describe("errMsg typed mapping", () => {
  it("maps INVALID_CURRENT_PASSWORD", () => {
    expect(errMsg({ data: "INVALID_CURRENT_PASSWORD" })).toBe(
      "Current password / ID code is incorrect."
    );
  });
  it("maps TOO_MANY_ATTEMPTS", () => {
    expect(errMsg({ data: "TOO_MANY_ATTEMPTS" })).toBe(
      "Too many attempts. Try again in a minute."
    );
  });
  it("falls back to message for unknown codes", () => {
    expect(errMsg(new Error("Some other thing"))).toBe("Some other thing");
  });
  it("strips Uncaught Error: prefix", () => {
    expect(errMsg(new Error("Uncaught Error: foo"))).toBe("foo");
  });
});
```

Run: `npx vitest run src/lib/errors.test.ts` (Vitest is not currently in this repo; the verification gate instead is `npm test` for the Node side and a manual smoke for the client. If the user wants a client-side unit, add `vitest` + `jsdom` in a separate change — out of scope here.)

**Step 4: Run gates**

`npm run typecheck && npm test` (the existing 27 + 4 from Task 1).

**Step 5: Manual smoke**

1. Sign in with a provisioned employee.
2. Open the forced change-password modal.
3. Type the wrong current secret, click Update.
4. Expect the inline message to read "Current password / ID code is incorrect." (not "InvalidSecret" or "Error: InvalidSecret").
5. Type the right one, click Update.
6. Expect "Password updated. Use it from now on." and the page reloads.

**Step 6: Commit**

```bash
git add src/lib/errors.ts src/app/change-password.tsx
git commit -m "fix(j-pay): inline error copy for changeMyPassword typed failures"
```

---

## Validation Checklist (Final)

- [ ] `python3 scripts/check_consistency.py` — PASS
- [ ] `python3 scripts/check_diagrams.py` — PASS
- [ ] `npm test` — 31 passing (27 prior + 4 new)
- [ ] `npm run typecheck` — 0 errors
- [ ] `timeout 110 npx convex dev` — functions ready
- [ ] Manual smoke: wrong current secret → "Current password / ID code is incorrect."
- [ ] Manual smoke: right current secret → password updated, page reloads
- [ ] Manual smoke: no `InvalidSecret` string in the browser DevTools network response
- [ ] Git hygiene: each commit is scoped; no `git add -A`; no review artifacts staged

---

## Tech Debt (deferred, NOT in this plan)

- `convex/users.ts:118-143` `resetPasswordBreakGlass` calls `modifyAccountCredentials` directly (not affected) but the same `retrieveAccount` trap applies if we ever add a "verify old before reset" branch. Add the same `mapRetrieveResult` guard then.
- The `auth:store` string-literal call in Task 2 is a private-contract dependency. If `@convex-dev/auth` ships a minor that renames or restructures this internal, the action will surface a server error at runtime. Pin the package (already done) and re-verify on upgrade.
- Frontend mapper has no client-side unit test infrastructure in this repo. If a client-side gate is desired, add Vitest + jsdom in a separate change.
