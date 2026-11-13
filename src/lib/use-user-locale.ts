"use client";

import { useQuery, useConvexAuth } from "@/lib/backend/react";
import { useMemo } from "react";
import { api } from "@/lib/backend/api";
import { browserLocale } from "./format";

const FALLBACK_LOCALE = "en-ZA";

export function useUserLocale(): string {
  // H2 (2026-08-26): skip the query when unauthenticated — the header /
  // login page now passes "skip" instead of triggering an unnecessary
  // network round-trip (and a noisy "unauthenticated" console error).
  const { isAuthenticated } = useConvexAuth();
  const stored = useQuery(api.users.getMyLocale, isAuthenticated ? {} : "skip");
  return useMemo(() => {
    if (stored && typeof stored === "string" && stored.length > 0) return stored;
    return browserLocale();
  }, [stored]);
}


