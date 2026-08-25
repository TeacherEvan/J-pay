import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const publicDir = resolve(root, "public");

test("public/sw.js exists after next build", () => {
  assert.ok(
    existsSync(resolve(publicDir, "sw.js")),
    "public/sw.js missing — run `npm run build` first (Next 16.3.2 + Serwist 10 must generate the SW)"
  );
});

test("Serwist worker is present (either inlined into sw.js or as swe-worker-*.js)", () => {
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
