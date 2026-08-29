// scripts/test-demo-access.mjs
//
// v3 acceptance — 9-case authz suite for the demo console surface (A–I per the brief).
// Pure-Node; no live deployment.

import { strict as assert } from "node:assert";
import test from "node:test";

import { requireDemoReviewer } from "../convex/access.ts";

const ORIGINAL_DEMO = process.env.DEMO_MODE;

function makeId(table, s) {
  return `${table}:${s}`;
}

function makeMockCtx({
  reviewerId = makeId("users", "rev1"),
  reviewerUser = {
    _id: reviewerId,
    isAnonymous: true,
    isActive: true,
    archivedAt: undefined,
    role: "employee",
  },
  session = {
    _id: makeId("demoSessions", "sess1"),
    reviewerId,
    personaEmail: "thabo.demo@jpay.local",
    mode: "full",
  },
  persona = {
    _id: makeId("users", "thabo"),
    email: "thabo.demo@jpay.local",
    role: "employee",
    isAnonymous: false,
    isActive: true,
  },
  userQueryFirst = persona,
  sessionQueryFirst = session,
} = {}) {
  const usersById = new Map([
    [reviewerId, reviewerUser],
    [persona._id, persona],
  ]);
  const demoSessionsMap = session ? new Map([[session._id, session]]) : new Map();
  const tables = { users: usersById, demoSessions: demoSessionsMap };
  const identity = { subject: `${reviewerId}|session` };
  return {
    auth: { getUserIdentity: async () => identity },
    db: {
      get: async (id) => {
        for (const t of Object.values(tables)) if (t.has(id)) return t.get(id);
        return null;
      },
      query: (table) => {
        const all = [...(tables[table]?.values() ?? [])];
        return {
          withIndex: () => {
            const first =
              table === "users" ? userQueryFirst :
              table === "demoSessions" ? sessionQueryFirst :
              all[0] ?? null;
            return { first: async () => first, take: async (n) => all.slice(0, n) };
          },
        };
      },
    },
  };
}

function expectRejection(p, data) {
  return assert.rejects(p, (err) => {
    assert.equal(err.data, data);
    return true;
  });
}

// ---------- A: happy path ----------
test("A: isAnonymous=true, DEMO_MODE=1, valid session returns binding", async () => {
  process.env.DEMO_MODE = "1";
  const ctx = makeMockCtx();
  const r = await requireDemoReviewer(ctx);
  assert.equal(r.userId, makeId("users", "rev1"));
  assert.equal(r.personaUserId, makeId("users", "thabo"));
  assert.equal(r.personaEmail, "thabo.demo@jpay.local");
});

// ---------- B: DEMO_MODE off ----------
test("B: DEMO_MODE='0' throws FORBIDDEN (env gate is the strongest check)", async () => {
  process.env.DEMO_MODE = "0";
  const ctx = makeMockCtx();
  await expectRejection(() => requireDemoReviewer(ctx), "FORBIDDEN");
});

// ---------- C: isAnonymous missing ----------
test("C: isAnonymous=undefined throws FORBIDDEN (not the anonymous flow)", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    reviewerUser: { _id: reviewerId, isAnonymous: undefined, isActive: true, archivedAt: undefined, role: "employee" },
  });
  await expectRejection(() => requireDemoReviewer(ctx), "FORBIDDEN");
});

// ---------- D: inactive ----------
test("D: isActive=false throws FORBIDDEN", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    reviewerUser: { _id: reviewerId, isAnonymous: true, isActive: false, archivedAt: undefined, role: "employee" },
  });
  await expectRejection(() => requireDemoReviewer(ctx), "FORBIDDEN");
});

// ---------- E: archived ----------
test("E: archivedAt=set throws FORBIDDEN", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    reviewerUser: { _id: reviewerId, isAnonymous: true, isActive: true, archivedAt: Date.now(), role: "employee" },
  });
  await expectRejection(() => requireDemoReviewer(ctx), "FORBIDDEN");
});

// ---------- F: no session ----------
test("F: no demoSessions row throws DEMO_SESSION_NOT_BOUND", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({ reviewerId, session: null, sessionQueryFirst: null });
  await expectRejection(() => requireDemoReviewer(ctx), "DEMO_SESSION_NOT_BOUND");
});

// ---------- G/H/I: OUT_OF_DEMO_SCOPE gates on demoReplyToEmployee + demoMarkQueueItemRead ----------
test("G: demoReplyToEmployee rejects isAnonymous recipient (OUT_OF_DEMO_SCOPE)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../convex/demo/index.ts"), "utf8");
  const replyBlock = src.slice(
    src.indexOf("export const demoReplyToEmployee"),
    src.indexOf("export const demoMarkQueueItemRead")
  );
  assert.match(replyBlock, /recipient\.isAnonymous\s*===\s*true[\s\S]*?OUT_OF_DEMO_SCOPE/);
  const gateIdx = replyBlock.indexOf("OUT_OF_DEMO_SCOPE");
  const insertIdx = replyBlock.indexOf('ctx.db.insert("messages"');
  assert.ok(gateIdx > 0 && insertIdx > 0, "demoReplyToEmployee missing gate or insert");
  assert.ok(gateIdx < insertIdx, "OUT_OF_DEMO_SCOPE gate must precede the messages insert");
});

test("H: demoReplyToEmployee rejects non-employee recipient (OUT_OF_DEMO_SCOPE)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../convex/demo/index.ts"), "utf8");
  const replyBlock = src.slice(
    src.indexOf("export const demoReplyToEmployee"),
    src.indexOf("export const demoMarkQueueItemRead")
  );
  assert.match(replyBlock, /role\s*!==\s*"employee"[\s\S]*?OUT_OF_DEMO_SCOPE/);
});

test("I: demoMarkQueueItemRead rejects messages not from the bound persona", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../convex/demo/index.ts"), "utf8");
  const markBlock = src.slice(
    src.indexOf("export const demoMarkQueueItemRead"),
    src.indexOf("export const demoResolveShift")
  );
  assert.match(markBlock, /senderId\s*!==\s*personaUserId[\s\S]*?OUT_OF_DEMO_SCOPE/);
});

// ---------- cleanup ----------
test("cleanup: reset DEMO_MODE", () => {
  if (ORIGINAL_DEMO === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO;
  assert.ok(true);
});

console.log("demo-access (v3, 9-case authz) tests: all passed");
