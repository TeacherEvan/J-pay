/**
 * Offline authz + override harness for the manager feature set.
 * Stubs the DB in-memory and exercises the real invoked handlers through
 * src/lib/backend/runtime.ts — same pattern as test-invoke-gate.mjs.
 * Covers the scope guarantees the UI relies on: managers see only crews on
 * their managed sites (site-scoped auto-crew), non-manager viewers get
 * nothing, the override chain re-derives from logs,
 * and sealed (payroll-finalized) shifts refuse end-time overrides.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

const NOW = Date.now();
const H = 3600_000;

function fixture() {
  __stub.reset();
  const s = __stub.store;
  // Drop the stub's built-in fixtures (user-1/mod-1) so assertions see only mine.
  s.shifts.length = 0;
  s.users.push(
    { _id: "mgr-1", _creationTime: 11, role: "manager", email: "mgr1@x", name: "Mana G", isActive: true },
    { _id: "mgr-2", _creationTime: 12, role: "manager", email: "mgr2@x", name: "Mana H", isActive: true },
    { _id: "mgr-3", _creationTime: 13, role: "manager", email: "mgr3@x", name: "Mana I", isActive: true },
    { _id: "emp-1", _creationTime: 14, role: "employee", email: "e1@x", name: "Evan", isActive: true },
    { _id: "emp-2", _creationTime: 15, role: "employee", email: "e2@x", name: "Grace", isActive: true },
  );
  s.sites.push(
    { _id: "site-a", _creationTime: 20, name: "Alpha", latitude: -26.0, longitude: 28.0, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod-1" },
    { _id: "site-b", _creationTime: 21, name: "Bravo", latitude: -26.1, longitude: 28.1, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod-1" },
    { _id: "site-c", _creationTime: 22, name: "Charlie", latitude: -26.2, longitude: 28.2, geofenceRadiusMeters: 150, timezone: "Africa/Johannesburg", createdBy: "mod-1" },
  );
  s.userSites.push(
    { _id: "us-1", _creationTime: 30, userId: "emp-1", siteId: "site-a" },
    { _id: "us-2", _creationTime: 31, userId: "emp-1", siteId: "site-b" },
    { _id: "us-3", _creationTime: 32, userId: "emp-2", siteId: "site-b" },
  );
  s.managerSites = [
    { _id: "ms-1", _creationTime: 35, managerId: "mgr-1", siteId: "site-a" },
    { _id: "ms-2", _creationTime: 36, managerId: "mgr-2", siteId: "site-b" },
  ];
  s.shifts.push(
    { _id: "shift-e1", _creationTime: 40, userId: "emp-1", startedAt: NOW - 3 * H, needsReview: false },
    { _id: "shift-e2", _creationTime: 41, userId: "emp-2", startedAt: NOW - 5 * H, needsReview: false },
  );
  s.logs.push(
    { _id: "log-1", _creationTime: 50, userId: "emp-1", siteId: "site-a", clientReportedTime: NOW - 3 * H, clockSkewMs: 0, status: "arrived", latitude: -26.0001, longitude: 28.0001, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: "l1" },
    { _id: "log-2", _creationTime: 51, userId: "emp-2", siteId: "site-b", clientReportedTime: NOW - 5 * H, clockSkewMs: 0, status: "arrived", latitude: -26.1001, longitude: 28.1001, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: "l2" },
  );
  s.travelSegments = [
    { _id: "leg-1", _creationTime: 55, userId: "emp-1", fromSiteId: "site-a", departedAt: NOW - 1800e3, distanceMeters: 4200, pathSamples: [{ lat: -26.05, lng: 28.05, t: NOW - 600e3, s: 12 }], needsReview: false, lastFixKey: "k1" },
  ];
  s.shiftOverrides = [];
}

const asUser = (id) => ({ subject: id, email: `${id}@x`, name: id });

const run = async (label, fn) => {
  fixture();
  try {
    await fn();
    console.log(`✔ ${label}`);
  } catch (error) {
    console.error(`✖ ${label}\n  ${error?.message ?? error}`);
    process.exitCode = 1;
  }
};

const call = (module, fn, args, identity) => invoke({ module, fn }, args, identity, false);

await run("manager:managedActiveShifts scoped — mgr-1 sees only site-a crew (emp-1, travelling)", async () => {
  const rows = await call("manager", "managedActiveShifts", {}, asUser("mgr-1"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "emp-1");
  assert.equal(rows[0].travel?.distanceMeters, 4200);
  assert.equal(rows[0].lastLog.lat, -26.05);
  assert.equal(rows[0].lastLog.status, "travelling");
});

await run("manager:managedActiveShifts scoped — mgr-2 sees site-b crew {emp-1, emp-2}", async () => {
  const rows = await call("manager", "managedActiveShifts", {}, asUser("mgr-2"));
  assert.deepEqual(rows.map((r) => r.userId).sort(), ["emp-1", "emp-2"]);
});

await run("manager queries refuse anonymous / employee / moderator / site-less manager viewers", async () => {
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, null), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("emp-1")), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("mod-1")), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("mgr-3")), []);
  assert.deepEqual(await call("manager", "myCrew", {}, asUser("mgr-3")), []);
});

await run("manager:myCrew — mgr-1 roster + onShift badge", async () => {
  const crew = await call("manager", "myCrew", {}, asUser("mgr-1"));
  assert.deepEqual(crew.map((c) => c._id), ["emp-1"]);
  assert.ok(crew[0].onShift);
});

await run("manager:listManagedSites — mgr-1 gets Alpha only", async () => {
  const sites = await call("manager", "listManagedSites", {}, asUser("mgr-1"));
  assert.deepEqual(sites.map((s) => s.name), ["Alpha"]);
});

await run("travel:forUser — self ok, crew-scoped manager ok, outsider forbidden, employee cross-check refused", async () => {
  const own = await call("travel", "forUser", { userId: "emp-1" }, asUser("emp-1"));
  assert.equal(own.length, 1);
  const asMgr2 = await call("travel", "forUser", { userId: "emp-1" }, asUser("mgr-2"));
  assert.equal(asMgr2.length, 1);
  assert.equal((await call("travel", "forUser", { userId: "emp-2" }, asUser("mgr-1"))).length, 0);
  const asMod = await call("travel", "forUser", { userId: "emp-1" }, asUser("mod-1"));
  assert.equal(asMod.length, 1);
  await assert.rejects(() => call("travel", "forUser", { userId: "emp-1" }, asUser("emp-2")), /FORBIDDEN/);
});

await run("travel:recentForCrew — manager-only, crew scoped", async () => {
  const legs = await call("travel", "recentForCrew", { limit: 10 }, asUser("mgr-1"));
  assert.equal(legs.length, 1);
  assert.equal(legs[0].employeeName, "Evan");
  assert.deepEqual(await call("travel", "recentForCrew", {}, asUser("emp-1")), []);
});

await run("manager:setManagerSites — moderator replaces set transactionally; non-moderator refused", async () => {
  const result = await call("manager", "setManagerSites", { managerId: "mgr-1", siteIds: ["site-b", "site-c"] }, asUser("mod-1"));
  assert.equal(result.total, 2);
  const sites = await call("manager", "listManagedSites", {}, asUser("mgr-1"));
  assert.deepEqual(sites.map((s) => s.name).sort(), ["Bravo", "Charlie"]);
  const visible = await call("manager", "managedActiveShifts", {}, asUser("mgr-1"));
  assert.deepEqual(visible.map((r) => r.userId).sort(), ["emp-1", "emp-2"]);
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgr-2", siteIds: [] }, asUser("emp-1")),
    /FORBIDDEN/
  );
});

await run("manager:promoteToManager / demoteManager roundtrip; demotion archives managerSites + audits", async () => {
  // End active shift for emp-2 so promotion succeeds
  const s2 = __stub.store.shifts.find((s) => s.userId === "emp-2");
  if (s2) s2.endedAt = NOW - 1 * H;
  await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "emp-2").role, "manager");
  await call("manager", "setManagerSites", { managerId: "emp-2", siteIds: ["site-c"] }, asUser("mod-1"));
  await call("manager", "demoteManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "emp-2").role, "employee");
  // B7: rows archived, not deleted
  const rows = __stub.store.managerSites.filter((r) => r.managerId === "emp-2");
  assert.ok(rows.length > 0, "demotion must archive, not delete, managerSites rows");
  assert.ok(rows.every((r) => r.archivedAt !== undefined), "archived rows must carry archivedAt");
  // B7: audit ledger records promote / grant / demote
  const audit = (__stub.store.systemEvents ?? []).map((e) => e.kind);
  for (const kind of ["manager_promoted", "manager_sites_set", "manager_demoted"]) {
    assert.ok(audit.includes(kind), `systemEvents audit must include ${kind}`);
  }
});

await run("moderator:endShiftOverride — corrected end re-derives shift, payroll-payable, needsReview cleared", async () => {
  const before = __stub.store.shifts.find((s) => s.userId === "emp-2");
  const correctedEnd = before.startedAt + 4 * H;
  const res = await call("moderator", "endShiftOverride", { shiftId: before._id, endedAt: correctedEnd, reason: "employee forgot to log off" }, asUser("mod-1"));
  assert.equal(res.ok, true);
  const after = __stub.store.shifts.filter((s) => s.userId === "emp-2");
  assert.equal(after.length, 1);
  assert.equal(after[0].endedAt, correctedEnd);
  assert.equal(after[0].totalMinutes, 240);
  assert.equal(after[0].needsReview, false);
  assert.equal(after[0].reviewReason, "moderator_override");
  assert.equal(__stub.store.shiftOverrides.length, 1);
  assert.equal(__stub.store.shiftOverrides[0].shiftKey, String(before.startedAt));
});

await run("moderator:endShiftOverride — sealed shift refused (payroll locked)", async () => {
  const shift = __stub.store.shifts.find((s) => s.userId === "emp-1");
  shift.sealed = true;
  await assert.rejects(
    () => call("moderator", "endShiftOverride", { shiftId: shift._id, endedAt: shift.startedAt + H, reason: "payroll is already sealed" }, asUser("mod-1")),
    /PAYROLL_SEALED/
  );
});

await run("moderator:endShiftOverride — short reason / future end / wrong role rejected", async () => {
  const shift = __stub.store.shifts.find((s) => s.userId === "emp-1");
  await assert.rejects(
    () => call("moderator", "endShiftOverride", { shiftId: shift._id, endedAt: shift.startedAt + H, reason: "too short" }, asUser("mod-1")),
    /REASON_TOO_SHORT/
  );
  await assert.rejects(
    () => call("moderator", "endShiftOverride", { shiftId: shift._id, endedAt: Date.now() + 10 * H, reason: "way beyond reasonable time" }, asUser("mod-1")),
    /ENDED_IN_FUTURE/
  );
  await assert.rejects(
    () => call("moderator", "endShiftOverride", { shiftId: shift._id, endedAt: shift.startedAt + H, reason: "manager attempt at override" }, asUser("mgr-1")),
    /FORBIDDEN/
  );
});

await run("travel:setConsent — grant and revoke roundtrip on the users row", async () => {
  await call("travel", "setConsent", { consent: true }, asUser("emp-1"));
  assert.ok(__stub.store.users.find((u) => u._id === "emp-1").travelConsentAt > 0);
  await call("travel", "setConsent", { consent: false }, asUser("emp-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "emp-1").travelConsentAt, undefined);
});

await run("moderator:overridableShifts — sealed excluded", async () => {
  __stub.store.shifts.find((s) => s.userId === "emp-1").sealed = true;
  const rows = await call("moderator", "overridableShifts", {}, asUser("mod-1"));
  assert.deepEqual(rows.map((r) => r.userId).sort(), ["emp-2"]);
});

await run("manager:mid-shift promotion blocked (ACTIVE_SHIFT_IN_PROGRESS)", async () => {
  // emp-1 has an open shift (endedAt is undefined)
  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "emp-1" }, asUser("mod-1")),
    /ACTIVE_SHIFT_IN_PROGRESS/
  );
});

await run("manager:cross-org promotion blocked (CROSS_ORG_PROMOTION_FORBIDDEN)", async () => {
  // Give mod-1 an orgId
  const mod = __stub.store.users.find((u) => u._id === "mod-1");
  mod.orgId = "org-alpha";
  // Give emp-2 a completed shift and a different orgId
  const emp2 = __stub.store.users.find((u) => u._id === "emp-2");
  emp2.orgId = "org-beta";
  const s2 = __stub.store.shifts.find((s) => s.userId === "emp-2");
  if (s2) s2.endedAt = NOW - 1 * H;

  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1")),
    /CROSS_ORG_PROMOTION_FORBIDDEN/
  );

  // When org matches, promotion succeeds
  emp2.orgId = "org-alpha";
  const res = await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(res.ok, true);
  assert.equal(emp2.role, "manager");
});

await run("manager:cross-org site assignment blocked (CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN)", async () => {
  const mgr1 = __stub.store.users.find((u) => u._id === "mgr-1");
  mgr1.orgId = "org-alpha";

  const siteA = __stub.store.sites.find((s) => s._id === "site-a");
  siteA.orgId = "org-alpha";
  const siteB = __stub.store.sites.find((s) => s._id === "site-b");
  siteB.orgId = "org-beta";

  // Assigning site-b (org-beta) to mgr-1 (org-alpha) should be blocked
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgr-1", siteIds: ["site-a", "site-b"] }, asUser("mod-1")),
    /CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN/
  );

  // Assigning matching org site succeeds
  const res = await call("manager", "setManagerSites", { managerId: "mgr-1", siteIds: ["site-a"] }, asUser("mod-1"));
  assert.equal(res.total, 1);
});

await run("org guard fail-closed: unscoped moderator + scoped target refused; both unscoped allowed", async () => {
  // Default fixture: nobody has an orgId. Assign emp-2 an org, keep mod-1 unscoped.
  const emp2 = __stub.store.users.find((u) => u._id === "emp-2");
  emp2.orgId = "org-beta";
  const s2 = __stub.store.shifts.find((s) => s.userId === "emp-2");
  if (s2) s2.endedAt = NOW - 1 * H;

  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1")),
    /CROSS_ORG_PROMOTION_FORBIDDEN/
  );

  // And the inverse: scoped actor + unscoped target is equally refused.
  const mod1 = __stub.store.users.find((u) => u._id === "mod-1");
  mod1.orgId = "org-alpha";
  emp2.orgId = undefined;
  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1")),
    /CROSS_ORG_PROMOTION_FORBIDDEN/
  );

  // Both unscoped (default install) still works.
  mod1.orgId = undefined;
  const res = await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(res.ok, true);
});

await run("org guard fail-closed: unscoped manager + scoped site refused", async () => {
  const siteA = __stub.store.sites.find((s) => s._id === "site-a");
  siteA.orgId = "org-alpha";
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgr-1", siteIds: ["site-a"] }, asUser("mod-1")),
    /CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN/
  );
});

await run("sites:assignEmployee refuses cross-org assignment", async () => {
  const siteA = __stub.store.sites.find((s) => s._id === "site-a");
  siteA.orgId = "org-alpha";
  const emp1 = __stub.store.users.find((u) => u._id === "emp-1");
  emp1.orgId = undefined; // unscoped employee vs scoped site
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "emp-1", siteId: "site-a" }, asUser("mod-1")),
    /CROSS_ORG_ASSIGNMENT_FORBIDDEN/
  );
  // Same-org pair accepted
  emp1.orgId = "org-alpha";
  const newsite = __stub.store.sites.find((s) => s._id === "site-c");
  newsite.orgId = "org-alpha";
  const res = await call("sites", "assignEmployee", { userId: "emp-1", siteId: "site-c" }, asUser("mod-1"));
  assert.equal(res, undefined);
});

await run("org guard fail-closed: promotion inheritance skips cross-org sites but does not refuse promotion", async () => {
  // emp-2 (unscoped) assigned to org-alpha site site-b via userSites; promotion must succeed
  // but the scoped site must NOT be inherited into managerSites.
  const emp2 = __stub.store.users.find((u) => u._id === "emp-2");
  const s2 = __stub.store.shifts.find((s) => s.userId === "emp-2");
  if (s2) s2.endedAt = NOW - 1 * H;
  const siteB = __stub.store.sites.find((s) => s._id === "site-b");
  siteB.orgId = "org-alpha"; // scoped site; target unscoped

  const res = await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(res.ok, true, "promotion itself must succeed");
  const inherited = __stub.store.managerSites.filter((m) => m.managerId === "emp-2" && m.archivedAt === undefined);
  assert.equal(inherited.length, 0, "scoped site must not be inherited into managerSites for unscoped target");
});

await run("manager:automatic site inheritance on promotion", async () => {
  // emp-2 has userSites: site-b
  const s2 = __stub.store.shifts.find((s) => s.userId === "emp-2");
  if (s2) s2.endedAt = NOW - 1 * H;
  await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));

  // Check that managerSites was seeded with site-b
  const mgrSites = __stub.store.managerSites.filter((ms) => ms.managerId === "emp-2" && ms.archivedAt === undefined);
  assert.equal(mgrSites.length, 1);
  assert.equal(mgrSites[0].siteId, "site-b");
});

await run("manager:demotion orphan warning logged to systemEvents", async () => {
  // mgr-1 is the sole manager of site-a
  await call("manager", "demoteManager", { userId: "mgr-1" }, asUser("mod-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "mgr-1").role, "employee");

  // Check systemEvents for manager_demoted_orphan_sites
  const orphanEvents = (__stub.store.systemEvents ?? []).filter((e) => e.kind === "manager_demoted_orphan_sites");
  assert.equal(orphanEvents.length, 1);
  const detail = JSON.parse(orphanEvents[0].detail);
  assert.equal(detail.managerId, "mgr-1");
  assert.deepEqual(detail.orphanSiteIds, ["site-a"]);
});

console.log(process.exitCode ? "\nHARNESS FAILED" : "\nALL MANAGER-AUTHZ HARNESS CHECKS PASS");
