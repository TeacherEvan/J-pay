import assert from "node:assert/strict";
import test from "node:test";
import { issueDeviceToken, verifyDeviceToken } from "../convex/deviceTokens.ts";

const SECRET = "test-secret-material";
const USER = "user123";

test("issued token verifies against same user+secret", async () => {
  const { token, issuedAt } = await issueDeviceToken(USER, SECRET);
  assert.ok(await verifyDeviceToken(token, USER, SECRET, String(issuedAt)));
});

test("rejects different user (token theft across accounts)", async () => {
  const { token, issuedAt } = await issueDeviceToken(USER, SECRET);
  assert.equal(await verifyDeviceToken(token, "victim", SECRET, String(issuedAt)), false);
});

test("rejects wrong secret", async () => {
  const { token, issuedAt } = await issueDeviceToken(USER, SECRET);
  assert.equal(await verifyDeviceToken(token, USER, "other-secret", String(issuedAt)), false);
});

test("rejects when stored issuedAt missing or mismatched (revoked)", async () => {
  const { token, issuedAt } = await issueDeviceToken(USER, SECRET);
  assert.equal(await verifyDeviceToken(token, USER, SECRET, undefined), false);
  assert.equal(await verifyDeviceToken(token, USER, SECRET, "999"), false);
});

test("rejects tampered payload and malformed tokens", async () => {
  const { token, issuedAt } = await issueDeviceToken(USER, SECRET);
  const [ts, mac] = token.split(".");
  assert.equal(await verifyDeviceToken(`${Number(ts) + 1}.${mac}`, USER, SECRET, ts), false);
  assert.equal(await verifyDeviceToken("garbage", USER, SECRET, String(issuedAt)), false);
  assert.equal(await verifyDeviceToken(".abc", USER, SECRET, "0"), false);
});

test("distinct users → distinct tokens even at identical millisecond; base64url shape", async () => {
  const a = await issueDeviceToken(USER, SECRET);
  const b = await issueDeviceToken("userB", SECRET);
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^\d+\.[A-Za-z0-9_-]+$/);
});

test("same user re-issue within same ms is idempotent (by design)", async () => {
  const a = await issueDeviceToken(USER, SECRET);
  const b = await issueDeviceToken(USER, SECRET);
  if (a.issuedAt === b.issuedAt) {
    assert.equal(a.token, b.token);
  }
});
