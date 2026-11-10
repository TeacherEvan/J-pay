/**
 * Offline authz + override harness for the manager feature set.
 * Stubs the DB in-memory and exercises the real invoked handlers through
 * src/lib/backend/runtime.ts — same pattern as test-invoke-gate.mjs.
 * Covers the scope guarantees the UI relies on: managers see only crews on
 * their managed sites (site-scoped auto-crew), demo personas never surface,
 * non-manager viewers get nothing, the override chain re-derives from logs,
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
    { _id: "mgr-demo", _creationTime: 13, role: "manager", email: "persona.demo@jpay.local", name: "Persona Mgr", isActive: true },
    { _id: "emp-1", _creationTime: 14, role: "employee", email: "e1@x", name: "Evan", isActive: true },
    { _id: "emp-2", _creationTime: 15, role: "employee", email: "e2@x", name: "Grace", isActive: true },
    { _id: "demo-1", _creationTime: 16, role: "employee", email: "persona.demo@jpay.local", name: "Persona", isActive: true },
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
    { _id: "us-4", _creationTime: 33, userId: "demo-1", siteId: "site-a" },
  );
  s.managerSites = [
    { _id: "ms-1", _creationTime: 35, managerId: "mgr-1", siteId: "site-a" },
    { _id: "ms-2", _creationTime: 36, managerId: "mgr-2", siteId: "site-b" },
  ];
  s.shifts.push(
    { _id: "shift-e1", _creationTime: 40, userId: "emp-1", startedAt: NOW - 3 * H, needsReview: false },
    { _id: "shift-e2", _creationTime: 41, userId: "emp-2", startedAt: NOW - 5 * H, needsReview: false },
    { _id: "shift-demo", _creationTime: 42, userId: "demo-1", startedAt: NOW - 2 * H, needsReview: false },
  );
  s.logs.push(
    { _id: "log-1", _creationTime: 50, userId: "emp-1", siteId: "site-a", clientReportedTime: NOW - 3 * H, clockSkewMs: 0, status: "arrived", latitude: -26.0001, longitude: 28.0001, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: "l1" },
    { _id: "log-2", _creationTime: 51, userId: "emp-2", siteId: "site-b", clientReportedTime: NOW - 5 * H, clockSkewMs: 0, status: "arrived", latitude: -26.1001, longitude: 28.1001, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: "l2" },
    { _id: "log-3", _creationTime: 52, userId: "demo-1", siteId: "site-a", clientReportedTime: NOW - 2 * H, clockSkewMs: 0, status: "arrived", latitude: -26.0002, longitude: 28.0002, accuracyMeters: 10, isWithinGeofence: true, deviceMetadata: "x", idempotencyKey: "l3" },
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

await run("manager:managedActiveShifts scoped — mgr-1 sees only site-a crew (emp-1, travelling), demo excluded", async () => {
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

await run("manager queries refuse anonymous / employee / moderator / demo viewers", async () => {
  for (const mod of ["manager", "manager", "manager", "manager"]) {
    void mod;
  }
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, null), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("emp-1")), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("mod-1")), []);
  assert.deepEqual(await call("manager", "managedActiveShifts", {}, asUser("mgr-demo")), []);
  assert.deepEqual(await call("manager", "myCrew", {}, asUser("mgr-demo")), []);
});

await run("manager:myCrew — mgr-1 roster + onShift badge; demo personas never appear", async () => {
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

await run("manager:promoteToManager / demoteManager roundtrip; demotion drops managerSites", async () => {
  await call("manager", "promoteToManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "emp-2").role, "manager");
  await call("manager", "setManagerSites", { managerId: "emp-2", siteIds: ["site-c"] }, asUser("mod-1"));
  await call("manager", "demoteManager", { userId: "emp-2" }, asUser("mod-1"));
  assert.equal(__stub.store.users.find((u) => u._id === "emp-2").role, "employee");
  assert.equal(__stub.store.managerSites.filter((r) => r.managerId === "emp-2").length, 0);
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

await run("moderator:overridableShifts — demo personas excluded, sealed excluded", async () => {
  __stub.store.shifts.find((s) => s.userId === "emp-1").sealed = true;
  const rows = await call("moderator", "overridableShifts", {}, asUser("mod-1"));
  assert.deepEqual(rows.map((r) => r.userId).sort(), ["emp-2"]);
});

console.log(process.exitCode ? "\nHARNESS FAILED" : "\nALL MANAGER-AUTHZ HARNESS CHECKS PASS");
