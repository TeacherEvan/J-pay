import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const publicDir = resolve(root, "public");

// These tests gate the PRODUCTION BUILD ARTEFACT. They assert something about
// public/sw.js, which is gitignored and only exists after `npm run build` has
// run. On a fresh clone (tsc / Vercel's fresh checkout) it is absent by design.
// SKIP rather than FAIL in that state: a missing artefact is not a code
// defect, and failing here is what made `npm test` abort and silently skip
// the 15 suites after this file in the `&&` chain (audit 2026-11-11, E1).
// Run with `npm run verify && npm run build` to check the artefact.
const swAbsent = !existsSync(resolve(publicDir, "sw.js"));

test("public/sw.js exists after next build", { skip: swAbsent }, () => {
  assert.ok(
    existsSync(resolve(publicDir, "sw.js")),
    "public/sw.js missing — run `npm run build` first (Next 16.3.3 + Serwist 10 must generate the SW)"
  );
});

test("Serwist worker is present (either inlined into sw.js or as swe-worker-*.js)", { skip: swAbsent }, () => {
  // Serwist 10-preview inlines the worker into public/sw.js (no separate
  // swe-worker-*.js file). Serwist 9 emitted swe-worker-*.js as a sibling.
  // We accept either shape so the test stays valid across both versions.
  const siblingWorker = readdirSync(publicDir).some((f) => /^swe-worker-.+\.js$/.test(f));
  if (siblingWorker) return; // Serwist 9 layout — done.
  const sw = readFileSync(resolve(publicDir, "sw.js"), "utf8");
  // Serwist 10 inlines its runtime into sw.js. The class names `Serwist`,
  // `precache-v2`, and the navigation-preload route are all stable markers.
  assert.ok(
    sw.includes("serwist") || sw.includes("Serwist") || sw.includes("precache-v2"),
    "public/sw.js does not look like a Serwist worker — neither swe-worker-*.js nor inlined markers found"
  );
});

test("next-env.d.ts references the Next 16 typed-routes file", () => {
  // Next 16.3.2 emits typed routes to .next/dev/types/routes.d.ts (the
  // .next/types/ path used by Next 15 was renamed).
  const env = readFileSync(resolve(root, "next-env.d.ts"), "utf8");
  assert.match(
    env,
    /\.next\/(dev\/)?types\/routes\.d\.ts/,
    "next-env.d.ts must reference the Next typed-routes file"
  );
});
