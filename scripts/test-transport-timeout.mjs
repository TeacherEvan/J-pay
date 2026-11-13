#!/usr/bin/env node
/**
 * Transport-timeout regression wrapper — respawns under the TS loader like
 * scripts/test-react-adapter-dedup.mjs does.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(__dirname, "test-transport-timeout-worker.mjs");

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
      JPAY_TRANSPORT_TIMEOUT_TEST_RUNNER: "1",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key",
    },
  },
);

process.exit(result.status ?? 1);
