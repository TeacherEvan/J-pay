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
  s.systemEvents = [];
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
  const rows = await call("payroll", "calcForOrg", { orgId: "org-A", weeks: 1, weekOffset: 0, anchorMs: NOW }, asUser("mod"));
  const byId = Object.fromEntries(rows.map((r) => [r.userId, r.status]));
  assert.equal(byId.a1, "ok");
  assert.equal(byId.a2, "no_rate");
  assert.ok(!("b1" in byId));
});

await run("employees and managers cannot call moderator scope queries", async () => {
  for (const id of ["a1", "mgrA"]) {
    assert.deepEqual(await call("moderator", "listAllSites", { orgId: "org-A" }, asUser(id)), []);
    await assert.rejects(() => call("payroll", "calcForOrg", { orgId: "org-A", weeks: 1, weekOffset: 0, anchorMs: 0 }, asUser(id)));
  }
});

await run("users_queries:listModerators returns non-QA non-temp moderators only to active moderators", async () => {
  const s = __stub.store;
  s.users.push(
    { _id: "mod-a", _creationTime: 11, role: "moderator", email: "aaron@real.test", name: "aaron Mod", isActive: true, passwordChangedAt: NOW },
    { _id: "mod-arch", _creationTime: 12, role: "moderator", email: "zed@real.test", name: "zed Mod", isActive: false, archivedAt: NOW - 1000 },
    { _id: "mod-qa", _creationTime: 13, role: "moderator", email: "qa.mod@jpay.local", name: "QA Mod", isActive: true },
    { _id: "mod-temp", _creationTime: 14, role: "moderator", email: "mod@real.test", name: "Master Temp", isActive: true, isMasterTemp: true },
  );
  assert.deepEqual(await call("users_queries", "listModerators", {}, null), []);
  assert.deepEqual(await call("users_queries", "listModerators", {}, asUser("a1")), []);
  assert.deepEqual(await call("users_queries", "listModerators", {}, asUser("mgrA")), []);
  assert.deepEqual(await call("users_queries", "listModerators", {}, asUser("mod-arch")), []);

  const list = await call("users_queries", "listModerators", {}, asUser("mod"));
  assert.deepEqual(list.map((m) => m._id), ["mod-a", "mod", "mod-arch"]);
  assert.equal(list[0].hasChangedPassword, true);
  assert.equal(list[1].hasChangedPassword, false);
  assert.equal(list[2].isActive, false);
  assert.ok(typeof list[2].archivedAt === "number");
});

await run("users:deactivateModerator enforces self/last/type guards and logs audit event", async () => {
  const s = __stub.store;
  s.users.push(
    { _id: "mod-2", _creationTime: 11, role: "moderator", email: "mod2@real.test", name: "Mod Two", isActive: true },
    { _id: "mod-arch", _creationTime: 12, role: "moderator", email: "modarch@real.test", name: "Archived Mod", isActive: false, archivedAt: NOW - 1000 },
    { _id: "mod-qa", _creationTime: 13, role: "moderator", email: "qa.mod@jpay.local", name: "QA Mod", isActive: true },
    { _id: "mod-temp", _creationTime: 14, role: "moderator", email: "mod@real.test", name: "Temp Mod", isActive: true, isMasterTemp: true },
  );

  await assert.rejects(() => call("users", "deactivateModerator", { userId: "mod-2" }, asUser("a1")), /FORBIDDEN/);
  await assert.rejects(() => call("users", "deactivateModerator", { userId: "mod" }, asUser("mod")), /CANNOT_ARCHIVE_SELF/);
  await assert.rejects(() => call("users", "deactivateModerator", { userId: "a1" }, asUser("mod")), /NOT_A_MODERATOR/);
  await assert.rejects(() => call("users", "deactivateModerator", { userId: "mod-qa" }, asUser("mod")), /NOT_A_MODERATOR/);
  await assert.rejects(() => call("users", "deactivateModerator", { userId: "mod-temp" }, asUser("mod")), /NOT_A_MODERATOR/);
  await assert.rejects(() => call("users", "deactivateModerator", { userId: "missing" }, asUser("mod")), /NOT_A_MODERATOR/);

  const alreadyRes = await call("users", "deactivateModerator", { userId: "mod-arch" }, asUser("mod"));
  assert.deepEqual(alreadyRes, { ok: true, already: true });

  const res = await call("users", "deactivateModerator", { userId: "mod-2" }, asUser("mod"));
  assert.deepEqual(res, { ok: true, already: false });
  const mod2 = s.users.find((u) => u._id === "mod-2");
  assert.equal(mod2.isActive, false);
  assert.ok(typeof mod2.archivedAt === "number");

  const events = s.systemEvents.filter((e) => e.kind === "moderator_deactivated");
  assert.equal(events.length, 1);
  assert.equal(events[0].userId, "mod-2");
  assert.deepEqual(JSON.parse(events[0].detail), { actorId: "mod", targetUserId: "mod-2" });

  const idempotent = await call("users", "deactivateModerator", { userId: "mod-2" }, asUser("mod"));
  assert.deepEqual(idempotent, { ok: true, already: true });
  assert.equal(s.systemEvents.filter((e) => e.kind === "moderator_deactivated").length, 1);

  await assert.rejects(() => call("users", "deactivateModerator", { userId: "mod" }, asUser("mod-qa")), /LAST_MODERATOR/);
});

await run("moderator:resolveShift, setHourlyOverride, and recomputeEmployeeShifts enforce target org scope", async () => {
  const s = __stub.store;
  s.organisations.push({ _id: "org-Arch", _creationTime: 3, name: "Archived Org", archivedAt: NOW - 1000 });
  s.users.push(
    { _id: "empNoOrg", _creationTime: 11, role: "employee", email: "noorg@real.test", name: "No Org", isActive: true },
    { _id: "empArchOrg", _creationTime: 12, role: "employee", email: "arch@real.test", name: "Arch Org", isActive: true, orgId: "org-Arch" },
    { _id: "empQa", _creationTime: 13, role: "employee", email: "qa.emp@jpay.local", name: "QA Emp", isActive: true, orgId: "org-A" },
  );
  s.shifts.push(
    { _id: "sh-a1", _creationTime: 40, userId: "a1", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "x" },
    { _id: "sh-no-org", _creationTime: 41, userId: "empNoOrg", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "x" },
    { _id: "sh-arch-org", _creationTime: 42, userId: "empArchOrg", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "x" },
    { _id: "sh-qa", _creationTime: 43, userId: "empQa", startedAt: NOW - 2 * H, needsReview: true, reviewReason: "x" },
  );

  for (const shiftId of ["sh-no-org", "sh-arch-org", "sh-qa"]) {
    await assert.rejects(() => call("moderator", "resolveShift", { shiftId }, asUser("mod")), /FORBIDDEN/);
  }
  for (const userId of ["empNoOrg", "empArchOrg", "empQa", "missing-user"]) {
    await assert.rejects(() => call("moderator", "setHourlyOverride", { userId, rate: 150 }, asUser("mod")), /FORBIDDEN/);
    await assert.rejects(() => call("moderator", "recomputeEmployeeShifts", { userId }, asUser("mod")), /FORBIDDEN/);
  }

  const resolved = await call("moderator", "resolveShift", { shiftId: "sh-a1" }, asUser("mod"));
  assert.deepEqual(resolved, { ok: true });
  assert.equal(s.shifts.find((sh) => sh._id === "sh-a1").sealed, true);
  await call("moderator", "setHourlyOverride", { userId: "a1", rate: 175 }, asUser("mod"));
  assert.equal(s.users.find((u) => u._id === "a1").hourlyRateOverride, 175);
  await call("moderator", "recomputeEmployeeShifts", { userId: "a1" }, asUser("mod"));
});

await run("users:provisionEmployee validates org, role, rate, locale, and site org boundary before Supabase admin call", async () => {
  const s = __stub.store;
  s.organisations.push({ _id: "org-Arch", _creationTime: 3, name: "Archived Org", archivedAt: NOW - 1000 });
  s.sites.push(
    { _id: "site-Arch", _creationTime: 22, name: "Archived Site", orgId: "org-A", archivedAt: NOW - 500, latitude: -26, longitude: 28, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod" },
    { _id: "site-NoOrg", _creationTime: 23, name: "Orphan Site", latitude: -26, longitude: 28, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod" },
  );
  const base = { name: "New Hire", email: "newhire@real.test", orgId: "org-A" };

  await assert.rejects(() => call("users", "provisionEmployee", base, null), /UNAUTHENTICATED/);
  await assert.rejects(() => call("users", "provisionEmployee", base, asUser("a1")), /FORBIDDEN/);
  await assert.rejects(() => call("users", "provisionEmployee", { name: "New Hire", email: "newhire@real.test" }, asUser("mod")), /ORG_NOT_FOUND/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, orgId: "org-missing" }, asUser("mod")), /ORG_NOT_FOUND/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, orgId: "org-Arch" }, asUser("mod")), /ORG_NOT_FOUND/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, role: "moderator" }, asUser("mod")), /INVALID_ROLE/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, hourlyRateOverride: -1 }, asUser("mod")), /RATE_OUT_OF_RANGE/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, hourlyRateOverride: 100001 }, asUser("mod")), /RATE_OUT_OF_RANGE/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, hourlyRateOverride: Number.NaN }, asUser("mod")), /RATE_OUT_OF_RANGE/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, locale: "de-DE" }, asUser("mod")), /INVALID_LOCALE/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, siteIds: ["site-missing"] }, asUser("mod")), /SITE_NOT_FOUND/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, siteIds: ["site-Arch"] }, asUser("mod")), /SITE_ARCHIVED/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, siteIds: ["site-B"] }, asUser("mod")), /CROSS_ORG_ASSIGNMENT_FORBIDDEN/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, siteIds: ["site-NoOrg"] }, asUser("mod")), /CROSS_ORG_ASSIGNMENT_FORBIDDEN/);
  await assert.rejects(() => call("users", "provisionEmployee", { ...base, email: "a1@real.test" }, asUser("mod")), /USER_EXISTS/);
});

if (process.exitCode) { console.error("\nHARNESS FAILED"); } else { console.log("\norg isolation OK"); }
