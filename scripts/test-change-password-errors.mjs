import { test } from "node:test";
import assert from "node:assert/strict";

// Import the mapper directly from the same file the action uses.
// The shim-under-_generated approach was abandoned: a live `npx convex dev`
// regenerates that directory and deletes any hand-added file. The ts-ext loader
// (see scripts/register-ts-ext.mjs) resolves the .ts suffix transparently.
import { mapRetrieveResult } from "../convex/changePassword.ts";

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
