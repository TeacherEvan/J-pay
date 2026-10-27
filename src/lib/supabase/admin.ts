import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

/**
 * Service-role client. **Bypasses RLS** — server-only, never imported by a
 * client component, never returned to the browser.
 *
 * Key precedence:
 *   1. SUPABASE_SECRET_KEY        — new-style `sb_secret_…` key
 *   2. SUPABASE_SERVICE_ROLE_KEY  — legacy service_role JWT
 *
 * Note (2026-10-28): this project's `sb_secret_` value as returned by the
 * Management API is a masked preview (`sb_secret_coWk······`), so the working
 * server key in `.env.local` is the legacy service_role JWT. Regenerate a
 * secret key in the dashboard if you want to drop the JWT.
 */
export function hasSupabaseAdminKey(): boolean {
  return Boolean(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createSupabaseAdminClient(): SupabaseClient {
  const { url } = readSupabaseEnv();
  const serverKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serverKey) {
    throw new Error(
      "Supabase admin client requested but neither SUPABASE_SECRET_KEY nor " +
        "SUPABASE_SERVICE_ROLE_KEY is set in .env.local."
    );
  }

  return createClient(url, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
