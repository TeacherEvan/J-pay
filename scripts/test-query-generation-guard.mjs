#!/usr/bin/env node

/**
 * Monotonic generation guard regression — a slow in-flight query that resolves
 * AFTER a mutation committed to the backend must not overwrite post-mutation
 * state (audit 2026-11-17, P0 headline "Dual-backend split-brain" family and
 * Refactor 1/Prompt 1: "a slow query resolving after a mutation does not
 * overwrite invalidated cache state").
 *
 * The real hook (src/lib/backend/react.ts useQuery) is rendered under
 * react-test-renderer; fetch is driven by hand so the resolution order is
 * deterministic:
 *
 *   1. Query Q starts (fetch #1, generation G).
 *   2. A mutation lands mid-flight (invalidationBus.bump() → version G+1).
 *   3. Q resolves with the pre-mutation payload → the hook MUST drop it and
 *      re-issue; the DOM must never paint "stale".
 *   4. The re-issued fetch resolves with the post-mutation payload → painted.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(__dirname, "test-query-generation-guard-worker.mjs");

if (!process.env.JPAY_QGG_TEST_RUNNER) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      resolve(__dirname, "register-ts-ext.mjs"),
      workerPath,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        JPAY_QGG_TEST_RUNNER: "1",
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key",
      },
    }
  );
  process.exit(result.status ?? 0);
}
