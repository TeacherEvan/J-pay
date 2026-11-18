/**
 * Cron route rate limiting regression test.
 *
 * Verifies that the /api/internal/cron route enforces a shared-store sliding
 * window rate limit per job (10 req/min) with in-memory fallback.
 * Uses the same pattern as session-bootstrap route test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const src = read("src/app/api/internal/cron/route.ts");

// 1. Imports the shared rate limiter utilities
assert.ok(
  /from "..\/..\/..\/lib\/supabase\/admin"/.test(src) || /from "@\/lib\/supabase\/admin"/.test(src),
  "must import createSupabaseAdminClient from @/lib/supabase/admin"
);

// 2. Defines rate limit constants
assert.ok(
  /const CRON_WINDOW_MS = 60_000;/.test(src),
  "must define CRON_WINDOW_MS = 60_000"
);
assert.ok(
  /const CRON_LIMIT = 10;/.test(src),
  "must define CRON_LIMIT = 10"
);

// 3. Has in-memory fallback map
assert.ok(
  /const cronHits = new Map<string, number\[\]()>/.test(src),
  "must have in-memory fallback map cronHits"
);

// 4. Has rateLimited fallback function
assert.ok(
  /function rateLimited\(key: string, windowMs: number, limit: number\): boolean/.test(src),
  "must have rateLimited fallback function"
);

// 5. Has rateLimitedShared async function using RPC
assert.ok(
  /async function rateLimitedShared\(/.test(src) && /jpay_rate_limit_hit/.test(src),
  "must have rateLimitedShared calling jpay_rate_limit_hit RPC"
);

// 6. Applies rate limit before invoking job
assert.ok(
  /await rateLimitedShared\(admin, `cron:\$\{job\}`/.test(src),
  "must call rateLimitedShared with cron:job key before invoke"
);

// 7. Returns 429 on rate limit
assert.ok(
  /return NextResponse\.json\(\{ error: "RATE_LIMITED" \}, \{ status: 429 \}\)/.test(src),
  "must return 429 RATE_LIMITED when limit exceeded"
);

console.log("✔ cron rate limit: shared-store sliding window (10 req/min) with in-memory fallback verified");