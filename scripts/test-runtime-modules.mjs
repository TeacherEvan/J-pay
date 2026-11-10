/**
 * Runtime-registry completeness gate.
 *
 * Regression for the 2026-11-10 A2 gap: convex/manager.ts was committed but
 * never registered in src/lib/backend/runtime.ts MODULES, so every manager:*
 * call failed with UNKNOWN_FUNCTION while tsc and npm test stayed green.
 *
 * For every top-level convex module (demo/ included, _generated/ and
 * auth.config.ts excluded), every export that looks like a Convex handler
 * (object or function carrying a `_handler` function) must appear in
 * describeFunctions() as `<module>:<exportName>`.
 *
 * Runs fully offline via the TS transpile loader (same as test-invoke-gate).
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const convexDir = join(root, "convex");

function moduleKeys() {
  const keys = [];
  for (const f of readdirSync(convexDir)) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts") || f === "auth.config.ts") continue;
    keys.push(f.slice(0, -".ts".length));
  }
  for (const f of readdirSync(join(convexDir, "demo"))) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    keys.push(`demo/${f.slice(0, -".ts".length)}`);
  }
  return keys.sort();
}

// Intentionally not dispatched by src/lib/backend/runtime.ts:
const NOT_DISPATCHED = new Set([
  // Canonical export lives in demo.ts (re-exports demo/seed); the direct
  // path is a duplicate surface and is not registered.
  "demo/seed:seedAll",
]);

function isHandler(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof value._handler === "function";
}

const { describeFunctions } = await import("../src/lib/backend/runtime.ts");
const registered = new Set(describeFunctions().map((f) => f.key));
console.log(`registry census: ${registered.size} functions`);

const missing = [];
for (const key of moduleKeys()) {
  const mod = await import(pathToFileURL(join(convexDir, `${key}.ts`)).href);
  for (const [exportName, value] of Object.entries(mod)) {
    if (!isHandler(value)) continue;
    const fnKey = `${key}:${exportName}`;
    if (NOT_DISPATCHED.has(fnKey)) continue;
    if (!registered.has(fnKey)) missing.push(fnKey);
  }
}

if (missing.length > 0) {
  console.error(`FAIL: ${missing.length} handler export(s) missing from runtime MODULES:`);
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}
console.log("✔ runtime registry completeness: every handler export is dispatched");
