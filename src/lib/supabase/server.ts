import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers. It carries the caller's auth cookies, so queries run as the
 * signed-in user and RLS applies.
 *
 * Next 16: `cookies()` is async — always await it.
 * Cookie writes throw inside Server Components (read-only render). That is
 * expected; the SDK retries the write from a Server Action / Route Handler, so
 * swallowing it is the documented @supabase/ssr pattern.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, key } = readSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — the middleware/route handler owns
          // the refresh. Safe to ignore.
        }
      },
    },
  });
}

/**
 * Anonymous server client with no cookie plumbing. Use for public reads and
 * health probes where the caller's session is irrelevant.
 */
export function createSupabaseAnonClient(): SupabaseClient {
  const { url, key } = readSupabaseEnv();
  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
