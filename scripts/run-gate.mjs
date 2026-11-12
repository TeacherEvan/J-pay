#!/usr/bin/env node
/**
 * Gate runner (audit 2026-11-11, E1): replaces the `&&`-chain in npm test/verify.
 *
 * The old chain aborted on the first failing stage — so a spurious failure in one
 * suite silently skipped the remaining fifteen, including the security invariants
 * (invoke gate, manager authz, server clock). This runner executes EVERY stage,
 * prints a final PASS/FAIL summary, and exits 1 if any stage failed.
 *
 * Stages run sequentially (the suites share a process-global stub pattern and
 * transpile hooks; parallel is not safe and buys nothing at this scale).
 *
 * Usage: node scripts/run-gate.mjs [test|verify]
 */
import { spawnSync } from "node:child_process";

const TS_NODE = [
  "--experimental-strip-types",
  "--no-warnings",
  "--import", "./scripts/register-ts-ext.mjs",
];
const TS_TRANSPILE = ["--import", "./scripts/register-ts-transpile.mjs"];

const testNodeTest = [
  ...TS_NODE,
  "--test",
  "scripts/test-shift-engine.mjs",
  "scripts/test-shift-engine-fuzz.mjs",
  "scripts/test-device-tokens.mjs",
  "scripts/test-geo.mjs",
  "scripts/test-payroll-strategies.mjs",
  "scripts/test-change-password-errors.mjs",
  "scripts/test-err-msg.mjs",
  "scripts/test-next-build-artifacts.mjs",
  "scripts/test-punch-mutation.mjs",
  "scripts/test-shift-derivation-bounds.mjs",
  "scripts/test-shift-overrides.mjs",
  "scripts/test-outbox.mjs",
  "scripts/test-a11y-statics.mjs",
];

/** deno-lint-style: each stage is { label, cmd, args } */
const stagesFor = (mode) => {
  const stages = [
    { label: "node --test suites (engine, payroll, outbox, a11y, build-artefact…)", cmd: process.execPath, args: testNodeTest },
    { label: "payroll rounding (exact half-cent, P2-B10)", cmd: process.execPath, args: [...TS_NODE, "scripts/test-payroll-rounding.mjs"] },
    { label: "adapter render dedup", cmd: process.execPath, args: ["scripts/test-react-adapter-dedup.mjs"] },
    { label: "CSV export", cmd: process.execPath, args: [...TS_NODE, "scripts/test-csv.mjs"] },
    { label: "payroll jurisdictions", cmd: process.execPath, args: [...TS_NODE, "scripts/test-payroll-jurisdictions.mjs"] },
    { label: "schema parity (TRD §6 ↔ schema.ts ↔ migrations ↔ INDEX_FIELDS ↔ registry view)", cmd: process.execPath, args: ["scripts/test-schema-parity.mjs"] },
    { label: "invoke gate (internal handlers not browser-callable)", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-invoke-gate.mjs"] },
    { label: "smoke-key", cmd: process.execPath, args: [...TS_NODE, "scripts/test-smoke-key.mjs"] },
    { label: "useQuery loop", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-use-query-loop.mjs"] },
    { label: "scheduler retry", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-scheduler-retry.mjs"] },
    { label: "db adapter", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-db-adapter.mjs"] },
    { label: "travel window bounds (index-range pushdown, P2-B13)", cmd: process.execPath, args: ["scripts/test-travel-window-bounds.mjs"] },
    { label: "cron jobs map", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-cron-jobs.mjs"] },
    { label: "runtime module census", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-runtime-modules.mjs"] },
    { label: "manager authz + override chain + org guards", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-manager-authz.mjs"] },
    { label: "derivation-failure ledger", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-derivation-failure.mjs"] },
    { label: "derivation idempotency (upsert-in-place)", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-derivation-idempotent.mjs"] },
    { label: "org list counts", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-list-orgs.mjs"] },
    { label: "write-set telemetry", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/test-write-set.mjs"] },
    { label: "server-clock calibration", cmd: process.execPath, args: [...TS_NODE, "scripts/test-server-clock.mjs"] },
  ];
  if (mode === "verify") {
    stages.unshift(
      { label: "TRD consistency", cmd: "python3", args: ["scripts/check_consistency.py"] },
      { label: "mermaid diagram gate", cmd: "python3", args: ["scripts/check_diagrams.py"] },
      { label: "function-refs in sync", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/gen-function-refs.mjs", "--check"] },
    );
    stages.push({ label: "tsc --noEmit", cmd: "npx", args: ["tsc", "--noEmit"] });
  }
  return stages;
};

const mode = process.argv[2] ?? "test";
if (!["test", "verify", "verify:node"].includes(mode)) {
  console.error(`usage: node scripts/run-gate.mjs [test|verify|verify:node]`);
  process.exit(2);
}
const stages = stagesFor(mode);
// verify:node — the subset of verify that needs only Node (no python3):
// refs check + every test stage + tsc. Used by the Vercel build gate, whose
// image cannot be assumed to provide python3 (and shouldn't need it).
if (mode === "verify:node") {
  stages.unshift({ label: "function-refs in sync", cmd: process.execPath, args: [...TS_TRANSPILE, "scripts/gen-function-refs.mjs", "--check"] });
  stages.push({ label: "tsc --noEmit", cmd: "npx", args: ["tsc", "--noEmit"] });
}
console.log(`run-gate[${mode}]: executing ${stages.length} stage(s)…`);

const results = [];
for (const s of stages) {
  console.log(`\n=== [${results.length + 1}/${stages.length}] ${s.label} ===`);
  const r = spawnSync(s.cmd, s.args, { stdio: "inherit", shell: false });
  const code = r.status ?? (r.error ? 1 : 0);
  results.push({ label: s.label, code });
  if (code !== 0) console.log(`--- FAILED (exit ${code}): ${s.label}`);
}

console.log("\n================ run-gate summary ================");
for (const { label, code } of results) {
  console.log(`${code === 0 ? "PASS" : "FAIL"}  ${label}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(failed.length === 0
  ? `run-gate[${mode}]: ALL ${results.length} STAGES PASS`
  : `run-gate[${mode}]: ${failed.length}/${results.length} STAGE(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
