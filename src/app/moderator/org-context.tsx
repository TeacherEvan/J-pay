"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ViewId = "live" | "crew" | "access" | "payroll" | "audit" | "messages";
export type AuditSegment = "activity" | "review" | "corrections";

type ConsoleContextValue = {
  /** Organisation the moderator is working in. Every console view is scoped to it. */
  orgId: string | null;
  setOrgId: (id: string | null) => void;
  /** Employee currently open in the shared drawer. */
  focusUserId: string | null;
  openUser: (id: string) => void;
  closeUser: () => void;
  /** Active tab + a user filter the destination tab should apply. */
  view: ViewId;
  userFilter: string | null;
  auditSegment: AuditSegment;
  goto: (view: ViewId, opts?: { userId?: string | null; auditSegment?: AuditSegment }) => void;
  setView: (view: ViewId) => void;
  clearUserFilter: () => void;
};

const noop = () => {};
const ConsoleContext = createContext<ConsoleContextValue>({
  orgId: null,
  setOrgId: noop,
  focusUserId: null,
  openUser: noop,
  closeUser: noop,
  view: "live",
  userFilter: null,
  auditSegment: "activity",
  goto: noop,
  setView: noop,
  clearUserFilter: noop,
});

/** Back-compat name: panels written before the revamp import `useOrg`. */
export function useOrg() {
  return useContext(ConsoleContext);
}
export const useConsole = useOrg;

const ORG_KEY = "jpay.currentOrg";

/**
 * Console-wide state: selected organisation (persisted), the employee drawer,
 * and cross-tab navigation ("Payroll →" on a user jumps there pre-filtered).
 * There is deliberately no "all organisations" mode — every view is
 * scoped to exactly one org so results are never ambiguous.
 */
export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("live");
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [auditSegment, setAuditSegment] = useState<AuditSegment>("activity");

  useEffect(() => {
    try {
      setOrgIdState(window.localStorage.getItem(ORG_KEY));
    } catch {
      // private mode / disabled storage — session-only selection
    }
  }, []);

  const setOrgId = useCallback((id: string | null) => {
    setOrgIdState(id);
    // A different org means a different crew: drop any user focus/filter.
    setFocusUserId(null);
    setUserFilter(null);
    try {
      if (id) window.localStorage.setItem(ORG_KEY, id);
      else window.localStorage.removeItem(ORG_KEY);
    } catch {
      // ignore
    }
  }, []);

  const goto = useCallback<ConsoleContextValue["goto"]>((next, opts) => {
    setView(next);
    setUserFilter(opts?.userId ?? null);
    if (opts?.auditSegment) setAuditSegment(opts.auditSegment);
    setFocusUserId(null);
  }, []);

  const value = useMemo<ConsoleContextValue>(
    () => ({
      orgId,
      setOrgId,
      focusUserId,
      openUser: setFocusUserId,
      closeUser: () => setFocusUserId(null),
      view,
      userFilter,
      auditSegment,
      goto,
      setView: (v) => {
        setView(v);
        setUserFilter(null);
      },
      clearUserFilter: () => setUserFilter(null),
    }),
    [orgId, setOrgId, focusUserId, view, userFilter, auditSegment, goto],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}
