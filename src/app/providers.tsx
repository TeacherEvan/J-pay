"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Root provider.
 *
 * This used to build a ConvexReactClient and wrap the tree in
 * ConvexAuthProvider. Supabase Auth keeps its session in the @supabase/ssr
 * cookie-backed client instead, and the hooks in src/lib/backend/react.ts
 * subscribe to that session directly — so this only has to warm the client up.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Creates the auth listener once per page load and keeps the access token
    // refreshed while the tab is open.
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getSession();
  }, []);

  return <>{children}</>;
}
