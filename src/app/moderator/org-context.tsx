"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type OrgContextValue = { orgId: string | null; setOrgId: (id: string | null) => void };

const OrgContext = createContext<OrgContextValue>({ orgId: null, setOrgId: () => {} });

export function useOrg() {
  return useContext(OrgContext);
}

/**
 * Holds the organisation the moderator is currently working in.
 * Sites are created AFTER an org exists — inside it — and user provisioning
 * lands in the same org. Persisted to localStorage so the selection survives reloads.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgIdState] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOrgIdState(window.localStorage.getItem("jpay.currentOrg"));
    } catch {
      // private mode / disabled storage — session-only selection
    }
  }, []);

  const setOrgId = (id: string | null) => {
    setOrgIdState(id);
    try {
      if (id) window.localStorage.setItem("jpay.currentOrg", id);
      else window.localStorage.removeItem("jpay.currentOrg");
    } catch {
      // ignore
    }
  };

  return <OrgContext.Provider value={{ orgId, setOrgId }}>{children}</OrgContext.Provider>;
}
