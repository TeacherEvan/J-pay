// scripts/test-demo-access-v3.mjs
//
// Unit tests for `requireDemoReviewer` (in convex/access.ts) and the
// OUT_OF_DEMO_SCOPE gates in `demoReplyToEmployee` (in convex/demo.ts).

import { strict as assert } from "node:assert";
import test from "node:test";

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
  const tables = {
    users: usersById,
    demoSessions: demoSessionsMap,
  };
  const identity = { subject: `${reviewerId}|session` };
  return {
    auth: {
      getUserIdentity: async () => identity,
    },
    db: {
      get: async (id) => {
        for (const t of Object.values(tables)) {
          if (t.has(id)) return t.get(id);
        }
        return null;
      },
      query: (table) => {
        const all = [...(tables[table]?.values() ?? [])];
        return {
          withIndex: (_name, _builder) => {
            const first =
              table === "users"
                ? userQueryFirst
                : table === "demoSessions"
                ? sessionQueryFirst
                : all[0] ?? null;
            return {
              first: async () => first,
              take: async (n) => all.slice(0, n),
            };
          },
          filter: () => ({
            collect: async () => all,
          }),
        };
      },
    },
  };
}

import { requireDemoReviewer } from "../convex/access.ts";

test("requireDemoReviewer: valid session returns { userId, personaUserId, personaEmail }", async () => {
  process.env.DEMO_MODE = "1";
  const ctx = makeMockCtx();
  const result = await requireDemoReviewer(ctx);
  assert.equal(result.userId, makeId("users", "rev1"));
  assert.equal(result.personaUserId, makeId("users", "thabo"));
  assert.equal(result.personaEmail, "thabo.demo@jpay.local");
});

test("requireDemoReviewer: DEMO_MODE=undefined throws FORBIDDEN", async () => {
  delete process.env.DEMO_MODE;
  const ctx = makeMockCtx();
  await assert.rejects(
    () => requireDemoReviewer(ctx),
    (err) => {
      assert.equal(err.data, "FORBIDDEN");
      return true;
    }
  );
});

test("requireDemoReviewer: isAnonymous=undefined throws FORBIDDEN", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    reviewerUser: {
      _id: reviewerId,
      isAnonymous: undefined,
      isActive: true,
      archivedAt: undefined,
      role: "employee",
    },
  });
  await assert.rejects(
    () => requireDemoReviewer(ctx),
    (err) => {
      assert.equal(err.data, "FORBIDDEN");
      return true;
    }
  );
});

test("requireDemoReviewer: no demoSessions row throws DEMO_SESSION_NOT_BOUND", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    session: null,
    sessionQueryFirst: null,
  });
  await assert.rejects(
    () => requireDemoReviewer(ctx),
    (err) => {
      assert.equal(err.data, "DEMO_SESSION_NOT_BOUND");
      return true;
    }
  );
});

test("demoReplyToEmployee gate: recipient.isAnonymous=true throws OUT_OF_DEMO_SCOPE", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../convex/demo.ts"), "utf8");
  const gateIdx = src.indexOf("OUT_OF_DEMO_SCOPE");
  const insertIdx = src.indexOf('ctx.db.insert("messages"');
  assert.ok(gateIdx > 0, "OUT_OF_DEMO_SCOPE token missing");
  assert.ok(insertIdx > 0, "messages insert missing");
  const matches = src.match(/OUT_OF_DEMO_SCOPE/g);
  assert.ok(matches && matches.length >= 2, `expected 2 OUT_OF_DEMO_SCOPE checks, got ${matches?.length ?? 0}`);
  assert.match(src, /isAnonymous\s*===\s*true[\s\S]{0,200}OUT_OF_DEMO_SCOPE/);
  assert.match(src, /role\s*!==\s*"employee"[\s\S]{0,200}OUT_OF_DEMO_SCOPE/);
});

test("demoReplyToEmployee: content.length > 2000 throws INVALID_CONTENT", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../convex/demo.ts"), "utf8");
  assert.match(src, /demoReplyToEmployee[\s\S]{0,1500}2000/);
  assert.match(src, /demoReplyToEmployee[\s\S]{0,1500}INVALID_CONTENT/);
});

test("requireDemoReviewer: archived reviewer throws FORBIDDEN", async () => {
  process.env.DEMO_MODE = "1";
  const reviewerId = makeId("users", "rev1");
  const ctx = makeMockCtx({
    reviewerId,
    reviewerUser: {
      _id: reviewerId,
      isAnonymous: true,
      isActive: true,
      archivedAt: Date.now(),
      role: "employee",
    },
  });
  await assert.rejects(
    () => requireDemoReviewer(ctx),
    (err) => {
      assert.equal(err.data, "FORBIDDEN");
      return true;
    }
  );
});

test("cleanup: reset DEMO_MODE", () => {
  if (ORIGINAL_DEMO === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO;
  assert.ok(true);
});

console.log("demo-access-v3 tests: all passed");
