/**
 * MVTH#3 — organisations:listOrgs counts must exclude archived orgs, sites and users.
 * Offline harness through src/lib/backend/runtime.ts (same pattern as test-manager-authz.mjs).
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

__stub.reset();
const s = __stub.store;
s.organisations = [
  { _id: "org-a", _creationTime: 1, name: "Alpha Org", createdBy: "mod-1" },
  { _id: "org-b", _creationTime: 2, name: "Beta Org", createdBy: "mod-1" },
  { _id: "org-old", _creationTime: 3, name: "Archived Org", createdBy: "mod-1", archivedAt: 999 },
];
s.sites = [
  { _id: "site-1", _creationTime: 10, name: "S1", orgId: "org-a" },
  { _id: "site-2", _creationTime: 11, name: "S2", orgId: "org-a" },
  { _id: "site-3", _creationTime: 12, name: "S3", orgId: "org-b" },
  { _id: "site-arch", _creationTime: 13, name: "S4", orgId: "org-a", archivedAt: 999 },
];
s.users = [
  { _id: "u-1", _creationTime: 20, role: "employee", email: "a@x", name: "A", isActive: true, orgId: "org-a" },
  { _id: "u-2", _creationTime: 21, role: "employee", email: "b@x", name: "B", isActive: true, orgId: "org-a" },
  { _id: "u-3", _creationTime: 22, role: "employee", email: "c@x", name: "C", isActive: true, orgId: "org-a", archivedAt: 999 },
  { _id: "u-4", _creationTime: 23, role: "employee", email: "d@x", name: "D", isActive: true, orgId: "org-b" },
  { _id: "mod-1", _creationTime: 24, role: "moderator", email: "m@x", name: "Mod", isActive: true },
];

const modIdentity = { subject: "mod-1", email: "mod-1@x", name: "mod-1" };
const result = await invoke({ module: "organisations", fn: "listOrgs" }, {}, modIdentity, /* fromServer */ false);
const byId = Object.fromEntries(result.map((o) => [o._id, o]));
assert.deepEqual(Object.keys(byId).sort(), ["org-a", "org-b"], "archived org must not be listed");
assert.equal(byId["org-a"].siteCount, 2, "archived site excluded from org-a");
assert.equal(byId["org-a"].userCount, 2, "archived user excluded from org-a");
assert.equal(byId["org-b"].siteCount, 1);
assert.equal(byId["org-b"].userCount, 1);

console.log("listOrgs counts OK: archived org/site/user excluded; org-b scope correct");
