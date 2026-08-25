"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { browserLocale } from "./format";

const FALLBACK_LOCALE = "en-ZA";

export function useUserLocale(): string {
  const stored = useQuery(api.users.getMyLocale);
  return useMemo(() => {
    if (stored && typeof stored === "string" && stored.length > 0) return stored;
    return browserLocale();
  }, [stored]);
}

export { FALLBACK_LOCALE };
