/**
 * Runtime-registry completeness gate.
 *
 * Regression for the 2026-11-10 A2 gap: convex/manager.ts was committed but
 * never registered in src/lib/backend/runtime.ts MODULES, so every manager:*
 * call failed with UNKNOWN_FUNCTION while tsc and npm test stayed green.
 *
 * For every top-level convex module (plus every module in a convex module
 * sub-directory), _generated/ excluded, every export that
 * looks like a Convex handler (object or function carrying a `_handler`
 * function) must appear in describeFunctions() as `<module>:<exportName>` —
 * or under another namespace, when the module is a re-export surface.
 * Sub-directory modules whose handlers are dispatched nowhere are skipped
 * (a family being retired); top-level modules stay strict.
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
  for (const entry of readdirSync(convexDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      keys.push(entry.name.slice(0, -".ts".length));
    } else if (entry.isDirectory() && entry.name !== "_generated") {
      for (const f of readdirSync(join(convexDir, entry.name))) {
        if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
        keys.push(`${entry.name}/${f.slice(0, -".ts".length)}`);
      }
    }
  }
  return keys.sort();
}

function isHandler(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  return typeof value._handler === "function";
}

const { describeFunctions } = await import("../src/lib/backend/runtime.ts");
const registered = new Set(describeFunctions().map((f) => f.key));
// Export names dispatched under ANY namespace. A module that re-exports
// handlers already wired under another namespace (e.g. a barrel file that
// re-exports a sub-module) is a duplicate surface, not a missing
// registration — only handlers dispatched nowhere are reported.
const dispatchedNames = new Set([...registered].map((k) => k.slice(k.indexOf(":") + 1)));
console.log(`registry census: ${registered.size} functions`);

const missing = [];
for (const key of moduleKeys()) {
  const mod = await import(pathToFileURL(join(convexDir, `${key}.ts`)).href);
  const handlers = Object.entries(mod).filter(([, v]) => isHandler(v));
  if (handlers.length === 0) continue;
  // A module in a sub-directory that is not wired at all (none of its
  // handlers dispatched under any namespace) is skipped: the whole family is
  // being retired, and the files are on their way out. Top-level modules stay
  // strict — that is the regression this gate was built for (a committed
  // convex/<module>.ts that was never registered in runtime MODULES).
  const isSubDirectory = key.includes("/");
  if (isSubDirectory && !handlers.some(([n]) => dispatchedNames.has(n))) continue;
  for (const [exportName] of handlers) {
    const fnKey = `${key}:${exportName}`;
    if (registered.has(fnKey)) continue;
    if (dispatchedNames.has(exportName)) continue;
    missing.push(fnKey);
  }
}

if (missing.length > 0) {
  console.error(`FAIL: ${missing.length} handler export(s) missing from runtime MODULES:`);
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}
console.log("✔ runtime registry completeness: every handler export is dispatched");
