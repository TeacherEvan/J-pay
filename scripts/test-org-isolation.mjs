/**
 * Multi-org isolation harness (console revamp 2026-11-13, audit F1-F5/F9).
 * Same pattern as test-manager-authz.mjs: in-memory stub + real handlers.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

const NOW = Date.now();
const H = 3600_000;
const asUser = (id) => ({ subject: id, email: `${id}@x`, name: id });
const call = (module, fn, args, identity) => invoke({ module, fn }, args, identity, false);

function fixture() {
  __stub.reset();
  const s = __stub.store;
  s.shifts.length = 0;
  s.users.length = 0;
  s.organisations = [
    { _id: "org-A", _creationTime: 1, name: "Org A" },
    { _id: "org-B", _creationTime: 2, name: "Org B" },
  ];
  const u = (id, role, orgId, extra = {}) =>
    s.users.push({ _id: id, _creationTime: 10, role, email: `${id}@real.test`, name: id, isActive: true, orgId, ...extra });
  u("mod", "moderator", undefined);
  u("a1", "employee", "org-A", { hourlyRateOverride: 100 });
  u("a2", "employee", "org-A"); // no rate -> no_rate row
  u("b1", "employee", "org-B", { hourlyRateOverride: 100 });
  u("mgrA", "manager", "org-A");
  u("mgrNone", "manager", undefined);
  s.sites.push(
    { _id: "site-A", _creationTime: 20, name: "A-site", orgId: "org-A", latitude: -26, longitude: 28, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod" },
    { _id: "site-B", _creationTime: 21, name: "B-site", orgId: "org-B", latitude: -26.1, longitude: 28.1, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod" },
  );
  s.userSites.push(
    { _id: "us1", _creationTime: 30, userId: "a1", siteId: "site-A" },
    { _id: "us2", _creationTime: 31, userId: "b1", siteId: "site-B" },
    // stale cross-org assignment: org-A manager's site also lists an org-B user
    { _id: "us3", _creationTime: 32, userId: "b1", siteId: "site-A" },
  );
  s.managerSites = [
    { _id: "ms1", _creationTime: 35, managerId: "mgrA", siteId: "site-A" },
    { _id: "ms2", _creationTime: 36, managerId: "mgrNone", siteId: "site-A" },
  ];
  s.travelSegments = [];
  s.shiftOverrides = [];
}

const mkLog = (i, userId, siteId, t) => ({
  _id: `log-${i}`, _creationTime: t, userId, siteId, clientReportedTime: t, clockSkewMs: 0, status: "arrived",
  latitude: -26, longitude: 28, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: `k${i}`,
});

const run = async (label, fn) => {
  fixture();
  try { await fn(); console.log(`✔ ${label}`); }
  catch (e) { console.error(`✖ ${label}\n  ${e?.message ?? e}`); process.exitCode = 1; }
};

await run("moderator queries are scoped to the selected org", async () => {
  const s = __stub.store;
  s.shifts.push(
    { _id: "sh-a", _creationTime: 40, userId: "a1", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "x" },
    { _id: "sh-b", _creationTime: 41, userId: "b1", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "y" },
  );
  s.logs.push(mkLog(1, "a1", "site-A", NOW - H), mkLog(2, "b1", "site-B", NOW - H));
  const roster = await call("moderator", "listEmployeesWithAssignments", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(roster.map((r) => r._id).sort(), ["a1", "a2", "mgrA"]);
  const sites = await call("moderator", "listAllSites", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(sites.map((x) => x._id), ["site-A"]);
  const audit = await call("moderator", "auditRecentLogs", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(audit.map((r) => r.userId), ["a1"]);
  const review = await call("moderator", "auditNeedsReview", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(review.map((r) => r.userId), ["a1"]);
  assert.equal(review[0].employeeName, "a1");
});

await run("busy org B cannot starve org A (take-before-filter, F4)", async () => {
  const s = __stub.store;
  s.logs.push(mkLog(0, "a1", "site-A", NOW - 5 * H));
  for (let i = 1; i <= 150; i++) s.logs.push(mkLog(i, "b1", "site-B", NOW - H + i));
  const audit = await call("moderator", "auditRecentLogs", { orgId: "org-A", limit: 50 }, asUser("mod"));
  assert.equal(audit.length, 1, "org A's single log must still show");
  for (let i = 0; i < 80; i++)
    s.shifts.push({ _id: `bs-${i}`, _creationTime: 100 + i, userId: "b1", startedAt: NOW - 3 * H - i, needsReview: true, reviewReason: "z" });
  s.shifts.push({ _id: "as-1", _creationTime: 5, userId: "a1", startedAt: NOW - 4 * H, needsReview: true, reviewReason: "z" });
  const review = await call("moderator", "auditNeedsReview", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(review.map((r) => r.userId), ["a1"]);
  const ov = await call("moderator", "overridableShifts", { orgId: "org-A" }, asUser("mod"));
  assert.deepEqual(ov.map((r) => r.userId), ["a1"]);
});

await run("manager without an org sees nothing and cannot message/broadcast (F1)", async () => {
  assert.deepEqual(await call("messages", "managerOrgUsers", {}, asUser("mgrNone")), []);
  await assert.rejects(() => call("messages", "managerMessage", { recipientId: "a1", content: "hi" }, asUser("mgrNone")), /NOT_IN_ORG/);
  await assert.rejects(() => call("messages", "managerBroadcast", { content: "hi" }, asUser("mgrNone")), /NOT_IN_ORG/);
  assert.deepEqual(await call("manager", "myCrew", {}, asUser("mgrNone")), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("mgrNone")), []);
});

await run("org-A manager never sees org-B people, even via a stale site assignment", async () => {
  const s = __stub.store;
  s.shifts.push(
    { _id: "sh-a", _creationTime: 40, userId: "a1", startedAt: NOW - 2 * H, needsReview: false },
    { _id: "sh-b", _creationTime: 41, userId: "b1", startedAt: NOW - 2 * H, needsReview: false },
  );
  assert.deepEqual((await call("manager", "myCrew", {}, asUser("mgrA"))).map((r) => r._id), ["a1"]);
  assert.deepEqual((await call("manager", "managedActiveShifts", {}, asUser("mgrA"))).map((r) => r.userId), ["a1"]);
  const peers = (await call("messages", "managerOrgUsers", {}, asUser("mgrA"))).map((r) => r._id);
  assert.ok(!peers.includes("b1") && peers.includes("a1"));
  await assert.rejects(() => call("messages", "managerMessage", { recipientId: "b1", content: "hi" }, asUser("mgrA")), /NOT_IN_ORG/);
  const sent = await call("messages", "managerBroadcast", { content: "hello" }, asUser("mgrA"));
  assert.equal(sent.sent, 2); // a1, a2 — not b1, not mgrNone
  assert.ok(!__stub.store.messages.some((m) => m.recipientId === "b1"));
  assert.deepEqual(await call("travel", "forUser", { userId: "b1" }, asUser("mgrA")), []);
});

await run("moderator broadcast reaches only the selected org", async () => {
  await call("messages", "broadcast", { orgId: "org-A", content: "ops" }, asUser("mod"));
  const to = __stub.store.messages.map((m) => m.recipientId).sort();
  assert.deepEqual(to, ["a1", "a2", "mgrA"]);
});

await run("org-less moderator can promote an in-org employee; org-less target refused (F2)", async () => {
  const res = await call("manager", "promoteToManager", { userId: "a1" }, asUser("mod"));
  assert.equal(res.ok, true);
  __stub.store.users.find((u) => u._id === "a2").orgId = undefined;
  await assert.rejects(() => call("manager", "promoteToManager", { userId: "a2" }, asUser("mod")), /ORG_REQUIRED/);
});

await run("createSite requires a live org (F3)", async () => {
  const base = { name: "N", latitude: -26, longitude: 28, geofenceRadiusMeters: 100, timezone: "Africa/Johannesburg" };
  await assert.rejects(() => call("sites", "createSite", base, asUser("mod")));
  await assert.rejects(() => call("sites", "createSite", { ...base, orgId: "org-missing" }, asUser("mod")), /ORG_NOT_FOUND|Invalid|not found/i);
  await call("sites", "createSite", { ...base, orgId: "org-A" }, asUser("mod"));
});

await run("calcForOrg: one row per member; missing rate is a row, not a failure (F9)", async () => {
  const rows = await call("payroll", "calcForOrg", { orgId: "org-A", fromMs: NOW - 7 * 24 * H, toMs: NOW }, asUser("mod"));
  const byId = Object.fromEntries(rows.map((r) => [r.userId, r.status]));
  assert.equal(byId.a1, "ok");
  assert.equal(byId.a2, "no_rate");
  assert.ok(!("b1" in byId));
});

await run("employees and managers cannot call moderator scope queries", async () => {
  for (const id of ["a1", "mgrA"]) {
    assert.deepEqual(await call("moderator", "listAllSites", { orgId: "org-A" }, asUser(id)), []);
    await assert.rejects(() => call("payroll", "calcForOrg", { orgId: "org-A", fromMs: 0, toMs: NOW }, asUser(id)));
  }
});

if (process.exitCode) { console.error("\nHARNESS FAILED"); } else { console.log("\norg isolation OK"); }
