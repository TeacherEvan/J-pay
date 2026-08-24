"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useMemo } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);
  if (!client) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-sm text-neutral-400">
        NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` to configure your deployment.
      </main>
    );
  }
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}

