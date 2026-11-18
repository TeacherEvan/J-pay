/**
 * Cross-org IDOR fuzzing test suite (multi-tenant security / audit).
 * Pattern mirrors scripts/test-org-isolation.mjs: in-memory db-stub + invoke runtime.
 * Systematically tests that authenticated users and managers in Org A cannot read,
 * mutate, or patch entities belonging to Org B by ID across handlers.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
process.env.PAYROLL_DEFAULT_RATE = "100";
process.env.PAYROLL_CURRENCY = "ZAR";
process.env.PAYROLL_STRATEGY = "flat";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

const NOW = Date.now();
const H = 3600_000;
const asUser = (id) => ({ subject: id, email: `${id}@real.test`, name: id });
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
    s.users.push({
      _id: id,
      _creationTime: 10,
      role,
      email: `${id}@real.test`,
      name: id,
      isActive: true,
      orgId,
      ...extra,
    });

  u("mod", "moderator", undefined);
  u("userA", "employee", "org-A", { hourlyRateOverride: 100 });
  u("mgrA", "manager", "org-A", { hourlyRateOverride: 150 });
  u("userB", "employee", "org-B", { hourlyRateOverride: 100 });
  u("mgrB", "manager", "org-B", { hourlyRateOverride: 150 });

  s.sites.push(
    {
      _id: "site-A",
      _creationTime: 20,
      name: "Site A",
      orgId: "org-A",
      latitude: -26.0,
      longitude: 28.0,
      geofenceRadiusMeters: 150,
      timezone: "Africa/Johannesburg",
      createdBy: "mod",
    },
    {
      _id: "site-B",
      _creationTime: 21,
      name: "Site B",
      orgId: "org-B",
      latitude: -26.1,
      longitude: 28.1,
      geofenceRadiusMeters: 150,
      timezone: "Africa/Johannesburg",
      createdBy: "mod",
    },
  );

  s.userSites.push(
    { _id: "us-A", _creationTime: 30, userId: "userA", siteId: "site-A" },
    { _id: "us-B", _creationTime: 31, userId: "userB", siteId: "site-B" },
  );

  s.managerSites = [
    { _id: "ms-A", _creationTime: 35, managerId: "mgrA", siteId: "site-A" },
    { _id: "ms-B", _creationTime: 36, managerId: "mgrB", siteId: "site-B" },
  ];

  s.shifts.push(
    {
      _id: "shift-A",
      _creationTime: 40,
      userId: "userA",
      startedAt: NOW - 2 * H,
      needsReview: true,
      reviewReason: "test-flag-A",
    },
    {
      _id: "shift-B",
      _creationTime: 41,
      userId: "userB",
      startedAt: NOW - 2 * H,
      needsReview: true,
      reviewReason: "test-flag-B",
    },
  );

  s.travelSegments = [
    {
      _id: "trav-A",
      _creationTime: 50,
      userId: "userA",
      fromSiteId: "site-A",
      departedAt: NOW - H,
      distanceMeters: 100,
      pathSamples: [],
    },
    {
      _id: "trav-B",
      _creationTime: 51,
      userId: "userB",
      fromSiteId: "site-B",
      departedAt: NOW - H,
      distanceMeters: 100,
      pathSamples: [],
    },
  ];

  s.messages = [];
  s.shiftOverrides = [];
  s.systemEvents = [];
}

const run = async (label, fn) => {
  fixture();
  try {
    await fn();
    console.log(`✔ ${label}`);
  } catch (e) {
    console.error(`✖ ${label}\n  ${e?.message ?? e}`);
    process.exitCode = 1;
  }
};

await run("moderator.resolveShift with Org B shiftId rejects with FORBIDDEN", async () => {
  const s = __stub.store;

  // Regular employee in Org A cannot resolve Org B shift
  await assert.rejects(
    () => call("moderator", "resolveShift", { shiftId: "shift-B" }, asUser("userA")),
    /FORBIDDEN/
  );

  // Manager in Org A cannot resolve Org B shift
  await assert.rejects(
    () => call("moderator", "resolveShift", { shiftId: "shift-B" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Verify shift-B remains unresolved and unsealed
  const shB = s.shifts.find((sh) => sh._id === "shift-B");
  assert.equal(shB.needsReview, true);
  assert.equal(shB.sealed ?? false, false);
});

await run("moderator.setHourlyOverride targeting Org B userId rejects with FORBIDDEN", async () => {
  const s = __stub.store;

  // Employee in Org A targeting Org B employee
  await assert.rejects(
    () => call("moderator", "setHourlyOverride", { userId: "userB", rate: 500 }, asUser("userA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B employee
  await assert.rejects(
    () => call("moderator", "setHourlyOverride", { userId: "userB", rate: 500 }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B manager
  await assert.rejects(
    () => call("moderator", "setHourlyOverride", { userId: "mgrB", rate: 500 }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Verify rate was not altered
  assert.equal(s.users.find((u) => u._id === "userB").hourlyRateOverride, 100);
  assert.equal(s.users.find((u) => u._id === "mgrB").hourlyRateOverride, 150);
});

await run("moderator.recomputeEmployeeShifts targeting Org B userId rejects with FORBIDDEN", async () => {
  // Employee in Org A targeting Org B employee
  await assert.rejects(
    () => call("moderator", "recomputeEmployeeShifts", { userId: "userB" }, asUser("userA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B employee
  await assert.rejects(
    () => call("moderator", "recomputeEmployeeShifts", { userId: "userB" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B manager
  await assert.rejects(
    () => call("moderator", "recomputeEmployeeShifts", { userId: "mgrB" }, asUser("mgrA")),
    /FORBIDDEN/
  );
});

await run("manager.assignEmployee targeting Org B userId or Org B siteId rejects", async () => {
  // manager.assignEmployee does not exist as an exposed handler, so direct calls reject
  await assert.rejects(
    () => call("manager", "assignEmployee", { userId: "userB", siteId: "site-A" }, asUser("mgrA"))
  );
  await assert.rejects(
    () => call("manager", "assignEmployee", { userId: "userA", siteId: "site-B" }, asUser("mgrA"))
  );
  await assert.rejects(
    () => call("manager", "assignEmployee", { userId: "userB", siteId: "site-B" }, asUser("mgrA"))
  );
  await assert.rejects(
    () => call("manager", "assignEmployee", { userId: "userB", siteId: "site-B" }, asUser("userA"))
  );

  // Manager in Org A cannot assign sites via setManagerSites
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgrA", siteIds: ["site-B"] }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgrB", siteIds: ["site-A"] }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Even moderator cannot assign Org B site to Org A manager (cross-org guard)
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgrA", siteIds: ["site-B"] }, asUser("mod")),
    /CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN/
  );
  await assert.rejects(
    () => call("manager", "setManagerSites", { managerId: "mgrB", siteIds: ["site-A"] }, asUser("mod")),
    /CROSS_ORG_SITE_ASSIGNMENT_FORBIDDEN/
  );
});

await run("manager.promoteToManager targeting Org B userId rejects", async () => {
  const s = __stub.store;

  // Employee in Org A targeting Org B employee
  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "userB" }, asUser("userA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B employee
  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "userB" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org A employee (moderator-only action)
  await assert.rejects(
    () => call("manager", "promoteToManager", { userId: "userA" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Verify userB role remains employee
  assert.equal(s.users.find((u) => u._id === "userB").role, "employee");
});

await run("sites.assignEmployee targeting Org B siteId rejects", async () => {
  const s = __stub.store;

  // Employee in Org A targeting Org B site
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "userA", siteId: "site-B" }, asUser("userA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B site
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "userA", siteId: "site-B" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Manager in Org A targeting Org B user + Org B site
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "userB", siteId: "site-B" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // Moderator cannot cross org boundaries when assigning employees
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "userA", siteId: "site-B" }, asUser("mod")),
    /CROSS_ORG_ASSIGNMENT_FORBIDDEN/
  );
  await assert.rejects(
    () => call("sites", "assignEmployee", { userId: "userB", siteId: "site-A" }, asUser("mod")),
    /CROSS_ORG_ASSIGNMENT_FORBIDDEN/
  );

  // setEmployeeSites bulk assignment rejects cross-org
  await assert.rejects(
    () => call("sites", "setEmployeeSites", { userId: "userA", siteIds: ["site-B"] }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("sites", "setEmployeeSites", { userId: "userA", siteIds: ["site-B"] }, asUser("mod")),
    /CROSS_ORG_ASSIGNMENT_FORBIDDEN/
  );

  // Verify no cross-org assignment was created
  assert.ok(!s.userSites.some((us) => us.userId === "userA" && us.siteId === "site-B"));
  assert.ok(!s.userSites.some((us) => us.userId === "userB" && us.siteId === "site-A"));
});

await run("additional IDOR fuzzing across other handlers", async () => {
  // messages.managerMessage: Org A manager cannot message Org B user
  await assert.rejects(
    () => call("messages", "managerMessage", { recipientId: "userB", content: "hi" }, asUser("mgrA")),
    /NOT_IN_ORG/
  );
  await assert.rejects(
    () => call("messages", "managerMessage", { recipientId: "mgrB", content: "hi" }, asUser("mgrA")),
    /NOT_IN_ORG/
  );

  // travel.forUser: Org A employee cannot read Org B travel
  await assert.rejects(
    () => call("travel", "forUser", { userId: "userB" }, asUser("userA")),
    /FORBIDDEN/
  );
  // travel.forUser: Org A manager gets empty array for Org B user (zero-leak)
  assert.deepEqual(await call("travel", "forUser", { userId: "userB" }, asUser("mgrA")), []);

  // payroll.calcForEmployee: cannot compute payroll for user in another org
  await assert.rejects(
    () => call("payroll", "calcForEmployee", { userId: "userB", weeks: 1, weekOffset: 0, anchorMs: NOW }, asUser("userA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("payroll", "calcForEmployee", { userId: "userB", weeks: 1, weekOffset: 0, anchorMs: NOW }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // users mutations targeting Org B user reject
  await assert.rejects(
    () => call("users", "setUserLocale", { userId: "userB", locale: "en-US" }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("users", "deactivateEmployee", { userId: "userB" }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("users", "resetDeviceToken", { userId: "userB" }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("manager", "demoteManager", { userId: "mgrB" }, asUser("mgrA")),
    /FORBIDDEN/
  );

  // punches.recordPunch: cannot punch at site of another org
  await assert.rejects(
    () => call("punches", "recordPunch", { siteId: "site-B", type: "in", lat: -26.1, lng: 28.1 }, asUser("userA")),
    /SITE_NOT_ASSIGNED/
  );

  // organisations.archiveOrg: cannot archive Org B as manager or user
  await assert.rejects(
    () => call("organisations", "archiveOrg", { orgId: "org-B" }, asUser("mgrA")),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => call("organisations", "archiveOrg", { orgId: "org-B" }, asUser("userA")),
    /FORBIDDEN/
  );
});

if (process.exitCode) {
  console.error("\nHARNESS FAILED");
} else {
  console.log("\ncross-org IDOR fuzzing OK");
}
