#!/usr/bin/env node
/**
 * Create a moderator account in a J-pay deployment (fork bootstrap or recovery).
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-moderator.mjs --email you@example.com --name "Full Name"
 *
 * What it does (the app's own provisioning contract, service-role edition):
 *   1. Refuses if a public.users row with the email already exists (no duplicates).
 *   2. Creates the Supabase Auth user with a GENERATED one-time password.
 *   3. Creates the public.users row (role moderator, isActive true) WITHOUT
 *      passwordChangedAt — so the app forces a password change on first sign-in
 *      (src/app/page.tsx, src/app/dashboard/page.tsx, src/app/moderator/page.tsx).
 *   4. Prints the one-time password ONCE. It is never written to disk, logs,
 *      or any config. Rotate immediately at first sign-in (forced anyway).
 *
 * Never pass a password on the command line. Never commit the output.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const email = get("--email")?.trim().toLowerCase();
const name = get("--name")?.trim();

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: node --env-file=.env.local scripts/create-moderator.mjs --email <email> --name \"<name>\"");
  process.exit(1);
}
if (!name || name.length > 100) {
  console.error("--name is required (max 100 chars)");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (did you pass --env-file=.env.local?)");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// 1. no duplicates
const { data: existing, error: lookupError } = await admin
  .from("users")
  .select("_id, email, role, isActive")
  .eq("email", email)
  .limit(1);
if (lookupError) { console.error("users lookup failed:", lookupError.message); process.exit(1); }
if (existing?.length) {
  console.error(`user already exists: ${email} (role=${existing[0].role}, isActive=${existing[0].isActive})`);
  process.exit(1);
}

// 2. auth user with generated one-time password
const oneTimePassword = randomBytes(24).toString("base64url");
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password: oneTimePassword,
  email_confirm: true,
  user_metadata: { name, role: "moderator" },
});
if (createError || !created?.user) {
  console.error("create user failed:", createError?.message ?? "unknown");
  process.exit(1);
}

// 3. public.users row (passwordChangedAt intentionally unset -> forced change on first login)
const { error: insertError } = await admin.from("users").insert({
  _id: created.user.id,
  name,
  email,
  role: "moderator",
  isActive: true,
});
if (insertError) {
  console.error("auth user created (id " + created.user.id + ") but public.users insert failed:", insertError.message);
  console.error("repair: insert public.users row manually with the same _id; do NOT create a second auth user.");
  process.exit(1);
}

// 4. one-time print
console.log("");
console.log("moderator account created for " + email);
console.log("one-time password (shown once, then rotate as forced on first login):");
console.log("");
console.log("    " + oneTimePassword);
console.log("");
console.log("sign in at / with email + password. The app will require an immediate password change.");
