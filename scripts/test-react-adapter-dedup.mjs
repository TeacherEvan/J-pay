#!/usr/bin/env node

/**
 * React Adapter Query Deduplication & Scoped Invalidation Verification Suite.
 *
 * Verifies:
 * 1. In-flight Promise Deduplication:
 *    - Concurrent calls for same query key share the same in-flight promise.
 *    - Distinct query keys (different ref or different args) do not share promises.
 *    - Failed in-flight queries are evicted from the deduplication map, allowing retries.
 * 2. Table / Scope-Aware Invalidation:
 *    - Mutations notify only listeners subscribed to overlapping affected tables.
 *    - Wildcard listeners (unfiltered) receive all notifications.
 *    - Static queries (0 tables) do not invalidate unnecessarily.
 *    - Unknown mutations safely trigger wildcard listeners and fall back gracefully.
 *    - Table mappings correctly resolve query and mutation schemas.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(__dirname, "test-react-adapter-dedup-worker.mjs");

// If not running under the custom loader, respawn with register-ts-ext.mjs and test env
if (!process.env.JPAY_DEDUP_TEST_RUNNER) {
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
        JPAY_DEDUP_TEST_RUNNER: "1",
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key",
      },
    }
  );

  process.exit(result.status ?? 0);
}
