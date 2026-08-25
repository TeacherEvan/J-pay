import { test } from "node:test";
import assert from "node:assert/strict";
import { errMsg } from "../src/lib/errors.ts";

test("errMsg: ConvexError with INVALID_CURRENT_PASSWORD -> friendly message", () => {
  // Shape mirrors what a ConvexError<string> looks like on the client:
  // `e.data` is the string passed to `new ConvexError(...)`.
  const e = { data: "INVALID_CURRENT_PASSWORD" };
  assert.equal(errMsg(e), "Current password / ID code is incorrect.");
});

test("errMsg: ConvexError with TOO_MANY_ATTEMPTS -> friendly message", () => {
  assert.equal(
    errMsg({ data: "TOO_MANY_ATTEMPTS" }),
    "Too many attempts. Try again in a minute."
  );
});

test("errMsg: ConvexError with ACCOUNT_NOT_FOUND -> friendly message", () => {
  assert.equal(
    errMsg({ data: "ACCOUNT_NOT_FOUND" }),
    "Account not found. Ask your moderator to re-provision you."
  );
});

test("errMsg: ConvexError with unknown code falls through to raw message", () => {
  // ConvexError<string> with an unmapped code: the shape still has `message`
  // inherited from Error (ConvexError extends Error), so the raw path applies.
  const e = Object.assign(new Error("UNAUTHENTICATED"), { data: "UNAUTHENTICATED" });
  assert.equal(errMsg(e), "UNAUTHENTICATED");
});

test("errMsg: ConvexError with non-string data falls through", () => {
  const e = Object.assign(new Error("structured payload"), { data: { reason: "x" } });
  assert.equal(errMsg(e), "structured payload");
});

test("errMsg: plain Error -> raw message, Uncaught prefix stripped", () => {
  assert.equal(errMsg(new Error("Uncaught Error: foo")), "foo");
  assert.equal(errMsg(new Error("plain")), "plain");
});

test("errMsg: non-Error value -> String() coercion", () => {
  assert.equal(errMsg("a string"), "a string");
  assert.equal(errMsg(undefined), "undefined");
});
