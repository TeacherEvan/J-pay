"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser-side Supabase client (publishable key only).
 *
 * Memoised as a module singleton because every `createBrowserClient` call
 * spins up its own auth listener — calling it per render leaks listeners.
 * Row access is governed by RLS, never by this key being "secret".
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const { url, key } = readSupabaseEnv();
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}

/** Test/HMR seam: drop the cached client so the next call rebuilds it. */
export function resetSupabaseBrowserClient(): void {
  browserClient = null;
}
