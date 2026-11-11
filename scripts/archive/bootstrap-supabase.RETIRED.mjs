#!/usr/bin/env node
/**
 * RETIRED 2026-11-11 (audit F20). Use `node --env-file=.env.local scripts/create-moderator.mjs --email <email> --name "Name"` — same job, documented contract, no stray deps.
 * ==================================================================
 * Bootstrap the first J-Pay moderator in Supabase.
 *
 * Creates the Supabase Auth identity and the matching public.users row, then
 * prints the ID code once. The app forces a password change on first sign-in.
 *
 *   node scripts/bootstrap-supabase.mjs <email> [name]
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read from .env.local).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path = ".env.local") {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
const name = (process.argv[3] ?? "Moderator").trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: node scripts/bootstrap-supabase.mjs <email> [name]");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const idCode = `JP-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET[b % 32]).join("")}`;

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password: idCode,
  email_confirm: true,
  user_metadata: { name, role: "moderator" },
});
if (error || !data.user) {
  console.error("createUser failed:", error?.message ?? "unknown");
  process.exit(1);
}

const { error: rowError } = await supabase.from("users").insert({
  _id: data.user.id,
  name,
  email,
  role: "moderator",
  isActive: true,
});
if (rowError) {
  console.error("users insert failed:", rowError.message);
  process.exit(1);
}

console.log(JSON.stringify({ email, idCode, userId: data.user.id }, null, 2));
