import assert from "node:assert/strict";
import test from "node:test";
import { issueDeviceToken, verifyDeviceToken } from "../convex/deviceTokens.ts";

const SECRET = "test-secret-material";
const USER = "user123";

test("issued token verifies against same user+secret", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  assert.ok(verifyDeviceToken(token, USER, SECRET, String(issuedAt)));
});

test("rejects different user (token theft across accounts)", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  assert.equal(verifyDeviceToken(token, "victim", SECRET, String(issuedAt)), false);
});

test("rejects wrong secret", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  assert.equal(verifyDeviceToken(token, USER, "other-secret", String(issuedAt)), false);
});

test("rejects when stored issuedAt missing or mismatched (revoked)", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  assert.equal(verifyDeviceToken(token, USER, SECRET, undefined), false);
  assert.equal(verifyDeviceToken(token, USER, SECRET, "999"), false);
});

test("rejects tampered payload and malformed tokens", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  const [ts, mac] = token.split(".");
  assert.equal(verifyDeviceToken(`${Number(ts) + 1}.${mac}`, USER, SECRET, ts), false);
  assert.equal(verifyDeviceToken("garbage", USER, SECRET, String(issuedAt)), false);
  assert.equal(verifyDeviceToken(".abc", USER, SECRET, "0"), false);
});

test("distinct issues → distinct tokens; base64url shape", () => {
  const a = issueDeviceToken(USER, SECRET);
  const b = issueDeviceToken(USER, SECRET);
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^\d+\.[A-Za-z0-9_-]+$/);
});

test("same inputs and timestamp verify identically (HMAC determinism)", () => {
  const { token, issuedAt } = issueDeviceToken(USER, SECRET);
  for (let i = 0; i < 3; i++) {
    assert.ok(verifyDeviceToken(token, USER, SECRET, String(issuedAt)));
  }
});
