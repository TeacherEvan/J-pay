#!/usr/bin/env node
/**
 * Idempotently create dedicated E2E test users (moderator + employee) in
 * Supabase Auth and `public.users`.
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-test-users.mjs
 *
 * Optional env overrides:
 *   E2E_MOD_EMAIL      (default: e2e-mod@jpay.test)
 *   E2E_MOD_PASSWORD   (default: generated if missing)
 *   E2E_EMP_EMAIL      (default: e2e-emp@jpay.test)
 *   E2E_EMP_PASSWORD   (default: generated if missing)
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (pass --env-file=.env.local).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const TEST_USERS = [
  {
    email: (process.env.E2E_MOD_EMAIL || "e2e-mod@jpay.test").trim().toLowerCase(),
    password: process.env.E2E_MOD_PASSWORD || randomBytes(18).toString("base64url"),
    name: "E2E Test Moderator",
    role: "moderator",
  },
  {
    email: (process.env.E2E_EMP_EMAIL || "e2e-emp@jpay.test").trim().toLowerCase(),
    password: process.env.E2E_EMP_PASSWORD || randomBytes(18).toString("base64url"),
    name: "E2E Test Employee",
    role: "employee",
  },
];

for (const spec of TEST_USERS) {
  const { data: existing, error: lookupError } = await admin
    .from("users")
    .select("_id, email, role, isActive")
    .eq("email", spec.email)
    .limit(1);

  if (lookupError) {
    console.error(`Lookup failed for ${spec.email}:`, lookupError.message);
    process.exit(1);
  }

  if (existing?.length) {
    console.log(`EXISTS  ${spec.role.padEnd(9)} ${spec.email} (id=${existing[0]._id}, active=${existing[0].isActive})`);
    continue;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: { name: spec.name, role: spec.role },
  });

  if (createError || !created?.user) {
    console.error(`Auth create failed for ${spec.email}:`, createError?.message ?? "unknown");
    process.exit(1);
  }

  const { error: insertError } = await admin.from("users").insert({
    _id: created.user.id,
    name: spec.name,
    email: spec.email,
    role: spec.role,
    isActive: true,
    passwordChangedAt: Date.now(),
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.error(`public.users insert failed for ${spec.email}:`, insertError.message);
    process.exit(1);
  }

  console.log(`CREATED ${spec.role.padEnd(9)} ${spec.email}  password=${spec.password}`);
}
