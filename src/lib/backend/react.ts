"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { refToKey, type FunctionRef } from "./api";

/**
 * Drop-in replacement for the `convex/react` + `@convex-dev/auth/react`
 * surface this app uses:
 *
 *   useQuery(ref, args)   useMutation(ref)   useAction(ref)
 *   useConvexAuth()       useAuthActions()   useConvex()
 *
 * Queries fetch from /api/backend/call and re-run whenever a mutation/action
 * completes or the auth state changes — the app was written against Convex's
 * reactive queries, so writes must refresh readers.
 */

export class BackendError extends Error {
  code: string;
  /** Mirrors ConvexError.data so src/lib/errors.ts keeps mapping typed codes. */
  data: string;

  constructor(code: string, message?: string) {
    super(message && message !== code ? `${code}: ${message}` : code);
    this.name = "BackendError";
    this.code = code;
    this.data = code;
  }
}

/* ------------------------------------------------ table / scope mappings -- */

export type TableName =
  | "users"
  | "sites"
  | "punches"
  | "userSites"
  | "logs"
  | "shifts"
  | "messages"
  | "pushSubscriptions"
  | "purgeAudit"
  | "reviewResolutions"
  | "demoSessions";

/**
 * Mapping of known mutation function keys to the tables/domains they mutate.
 */
export const MUTATION_TABLE_MAP: Record<string, readonly TableName[]> = {
  // logs & punches
  "logs:createLog": ["logs", "shifts"],
  "punches:recordPunch": ["punches", "logs", "shifts"],
  "punches:logPunch": ["punches", "logs", "shifts"], // alias for safety

  // sites
  "sites:createSite": ["sites"],
  "sites:assignEmployee": ["userSites"],
  "sites:unassignEmployee": ["userSites"],
  "sites:setEmployeeSites": ["userSites", "users"],

  // messages
  "messages:sendToModerators": ["messages"],
  "messages:replyToEmployee": ["messages"],
  "messages:broadcast": ["messages"],
  "messages:markThreadRead": ["messages"],
  "messages:markQueueItemRead": ["messages"],

  // moderator operations
  "moderator:resolveShift": ["shifts", "reviewResolutions"],
  "moderator:recomputeEmployeeShifts": ["shifts"],
  "moderator:setHourlyOverride": ["users"],

  // payroll
  "payroll:setPayStrategy": ["users"],

  // push
  "push_subs:saveSubscription": ["pushSubscriptions"],

  // users & account
  "users:deactivateEmployee": ["users"],
  "users:resetDeviceToken": ["users"],
  "users:setMyLocale": ["users"],
  "users:setUserLocale": ["users"],
  "users:issueMyDeviceToken": ["users"],
  "users:archiveMyMasterSession": ["users", "messages", "purgeAudit"],

  // demo operations
  "demo:bindReviewer": ["demoSessions"],
  "demo:switchPersona": ["demoSessions"],
  "demo:demoResolveShift": ["shifts", "reviewResolutions"],
  "demo:demoRecomputeEmployeeShifts": ["shifts"],
  "demo:demoMarkQueueItemRead": ["messages"],
  "demo:demoReplyToEmployee": ["messages"],
};

/**
 * Mapping of known query function keys to the tables they observe.
 */
export const QUERY_TABLE_MAP: Record<string, readonly TableName[]> = {
  // users
  "users_queries:me": ["users"],
  "users_queries:listEmployees": ["users"],
  "users:getMyLocale": ["users"],

  // sites & punches
  "sites:listMine": ["sites", "userSites"],
  "sites:getSiteForPunch": ["sites", "userSites"],
  "punches:getPunchHistory": ["punches", "userSites"],

  // logs & shifts
  "logs:listMine": ["logs"],

  // messages
  "messages:myInbox": ["messages"],
  "messages:moderatorInbox": ["messages"],

  // moderator
  "moderator:auditRecentLogs": ["logs", "users", "sites"],
  "moderator:auditNeedsReview": ["shifts", "users"],
  "moderator:activeShifts": ["shifts", "logs", "users", "sites"],
  "moderator:listEmployeesWithAssignments": ["users", "userSites", "sites"],
  "moderator:listAllSites": ["sites", "users"],

  // kpi & payroll
  "kpi:summary": ["logs", "shifts", "users", "sites"],
  "payroll:calcForEmployee": ["users", "shifts", "logs", "userSites", "sites"],
  "payroll:listSupportedStrategies": [],
  "payroll:listJurisdictionsForLocale": [],

  // push
  "push_subs:publicVapidKey": [],

  // demo
  "demo:status": ["demoSessions"],
  "demo:getBinding": ["demoSessions"],
  "demo:boundPersonaLogs": ["logs"],
  "demo:boundPersonaShifts": ["shifts"],
  "demo:boundPersonaPayroll": ["logs", "shifts", "users", "userSites", "sites"],
  "demo:demoAudit": ["logs", "users", "sites"],
  "demo:demoNeedsReview": ["shifts", "users"],
  "demo:demoKpis": ["logs", "shifts", "users", "sites"],
  "demo:demoEmployeeRoster": ["users", "userSites", "sites"],
  "demo:demoModeratorInbox": ["messages"],
  "demo:boundPersonaSites": ["sites", "userSites"],
};

export function getTablesForQuery(queryKey: string): readonly TableName[] | null {
  if (Object.prototype.hasOwnProperty.call(QUERY_TABLE_MAP, queryKey)) {
    return QUERY_TABLE_MAP[queryKey];
  }
  return null;
}

export function getTablesForMutation(mutationKey: string): readonly TableName[] | null {
  if (Object.prototype.hasOwnProperty.call(MUTATION_TABLE_MAP, mutationKey)) {
    return MUTATION_TABLE_MAP[mutationKey];
  }
  return null;
}

/* ------------------------------------------------------- invalidation bus -- */

export type InvalidationEvent = {
  mutationName?: string;
  tables?: readonly TableName[] | readonly string[];
};

type ListenerEntry = {
  tables: readonly string[] | null; // null means wildcard listener
  callback: () => void;
};

let version = 0;
const listenerEntries = new Set<ListenerEntry>();

export function bump(event?: InvalidationEvent): void {
  version += 1;

  let affectedTables: readonly string[] | null = null;
  if (event?.tables && event.tables.length > 0) {
    affectedTables = event.tables;
  } else if (event?.mutationName) {
    affectedTables = getTablesForMutation(event.mutationName);
  }

  for (const entry of Array.from(listenerEntries)) {
    // If mutation affected tables is unknown (null) or entry is wildcard (null), always notify
    if (!affectedTables || !entry.tables) {
      entry.callback();
      continue;
    }

    // If query has 0 tables (static query like publicVapidKey or supportedStrategies), do not invalidate
    if (entry.tables.length === 0) {
      continue;
    }

    // Check intersection
    const hasOverlap = entry.tables.some((t) => (affectedTables as readonly string[]).includes(t));
    if (hasOverlap) {
      entry.callback();
    }
  }
}

export function subscribe(
  tablesOrListener: readonly string[] | null | (() => void),
  maybeListener?: () => void
): () => void {
  let tables: readonly string[] | null = null;
  let listener: () => void;

  if (typeof tablesOrListener === "function") {
    tables = null;
    listener = tablesOrListener;
  } else {
    tables = tablesOrListener;
    listener = maybeListener!;
  }

  const entry: ListenerEntry = { tables, callback: listener };
  listenerEntries.add(entry);
  return () => {
    listenerEntries.delete(entry);
  };
}

/* ------------------------------------------- in-flight query deduplication -- */

const inFlightQueries = new Map<string, Promise<unknown>>();

/* ------------------------------------------------------------- transport -- */

async function accessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function callBackend(ref: unknown, args?: unknown): Promise<unknown> {
  const fnKey = refToKey(ref);
  const cacheKey = `${fnKey}::${JSON.stringify(args ?? {})}`;

  const existing = inFlightQueries.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const token = await accessToken();
    const response = await fetch("/api/backend/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ref: fnKey, args: args ?? {} }),
    });

    let payload: { result?: unknown; error?: string; message?: string } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // non-JSON error page
    }

    if (!response.ok) {
      throw new BackendError(payload.error ?? "INTERNAL", payload.message);
    }
    return payload.result;
  })();

  inFlightQueries.set(cacheKey, promise);

  const cleanup = () => {
    inFlightQueries.delete(cacheKey);
  };
  promise.then(cleanup, cleanup);

  return promise;
}

/* ------------------------------------------------------------------ hooks -- */

type QueryState = { key: string; data: unknown; error: Error | null };

export function useQuery<T = any>(
  ref: FunctionRef | string,
  args?: Record<string, unknown> | "skip"
): T | undefined {
  const skip = args === "skip";
  const refKey = useMemo(() => {
    try {
      return refToKey(ref);
    } catch {
      return "";
    }
  }, [ref]);
  const key = skip ? "" : `${refKey}::${JSON.stringify(args ?? {})}`;
  const [tick, setTick] = useState(version);
  const [state, setState] = useState<QueryState>({ key: "", data: undefined, error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const tables = useMemo(() => (refKey ? getTablesForQuery(refKey) : null), [refKey]);

  useEffect(() => {
    return subscribe(tables, () => setTick((v) => v + 1));
  }, [tables]);

  useEffect(() => {
    if (skip) return;
    let active = true;
    callBackend(ref, args)
      .then((result) => {
        if (!active || !mounted.current) return;
        setState({ key, data: result, error: null });
      })
      .catch((error: unknown) => {
        if (!active || !mounted.current) return;
        const resolved = error instanceof Error ? error : new Error(String(error));
        const code = (resolved as BackendError).code;
        if (code === "UNAUTHENTICATED" || code === "INACTIVE_ACCOUNT") {
          // Signed out mid-flight: behave like Convex returning null/undefined.
          setState({ key, data: null, error: null });
          return;
        }
        console.warn("[backend] query failed", refKey, resolved.message);
        setState({ key, data: undefined, error: resolved });
      });
    // Depend only on stable serialisations: `key` fully determines the request
    // (ref identity from the Proxy and inline `args` object identity both
    // change every render, so depending on them caused an endless fetch →
    // setState → render → fetch loop — audit 2026-11-10, P1-5).
    return () => {
      active = false;
    };
  }, [key, tick, skip]);

  if (skip) return undefined;
  if (state.key !== key) return undefined;
  return state.data as T | undefined;
}

export function useMutation<TArgs = any, TResult = any>(
  ref: FunctionRef | string
): (args?: TArgs) => Promise<TResult> {
  return useCallback(
    async (args?: TArgs) => {
      const result = (await callBackend(ref, (args ?? {}) as unknown)) as TResult;
      const mutationName = typeof ref === "string" ? ref : refToKey(ref);
      bump({ mutationName });
      return result;
    },
    [ref]
  );
}

export function useAction<TArgs = any, TResult = any>(
  ref: FunctionRef | string
): (args?: TArgs) => Promise<TResult> {
  return useCallback(
    async (args?: TArgs) => {
      const result = (await callBackend(ref, (args ?? {}) as unknown)) as TResult;
      const actionName = typeof ref === "string" ? ref : refToKey(ref);
      bump({ mutationName: actionName });
      return result;
    },
    [ref]
  );
}

/* ------------------------------------------------------------------- auth -- */

type SessionState = { loading: boolean; user: User | null };

let sessionState: SessionState = { loading: true, user: null };
const sessionListeners = new Set<() => void>();
let sessionInitialised = false;

function publishSession(next: SessionState): void {
  sessionState = next;
  for (const listener of sessionListeners) listener();
  bump();
}

function initSession(): void {
  if (sessionInitialised) return;
  sessionInitialised = true;
  const supabase = getSupabaseBrowserClient();
  void supabase.auth.getSession().then(({ data }) => {
    publishSession({ loading: false, user: data.session?.user ?? null });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    publishSession({ loading: false, user: session?.user ?? null });
  });
}

function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>(sessionState);
  useEffect(() => {
    initSession();
    const listener = () => setState(sessionState);
    sessionListeners.add(listener);
    listener();
    return () => {
      sessionListeners.delete(listener);
    };
  }, []);
  return state;
}

export function useConvexAuth(): {
  isLoading: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
} {
  const { loading, user } = useSessionState();
  return { isLoading: loading, isAuthenticated: Boolean(user), isAuthenticating: false };
}

type SignInParams = FormData | Record<string, unknown>;

/** Mirrors @convex-dev/auth's `signIn(provider, params)` contract. */
async function signIn(provider: string, params?: SignInParams): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const read = (key: string): string => {
    if (!params) return "";
    if (typeof FormData !== "undefined" && params instanceof FormData) {
      return String(params.get(key) ?? "");
    }
    return String((params as Record<string, unknown>)[key] ?? "");
  };

  if (provider === "password") {
    const email = read("email").trim().toLowerCase();
    const password = read("password");
    if (!email || !password) throw new BackendError("CREDENTIALS_REQUIRED");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("invalid login")) throw new BackendError("INVALID_CREDENTIALS");
      if (message.includes("email not confirmed")) throw new BackendError("EMAIL_NOT_CONFIRMED");
      if (message.includes("rate") || message.includes("too many")) {
        throw new BackendError("TOO_MANY_ATTEMPTS");
      }
      throw new BackendError("SIGN_IN_FAILED", error.message);
    }
    return;
  }

  if (provider === "anonymous" || provider === "master") {
    const response = await fetch("/api/auth/session-bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: provider === "anonymous" ? "demo" : "master",
        email: read("email"),
        secret: read("secret"),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      error?: string;
    };
    if (!response.ok || !payload.email || !payload.password) {
      throw new BackendError(payload.error ?? "SIGN_IN_FAILED");
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
    });
    if (error) throw new BackendError("SIGN_IN_FAILED", error.message);
    return;
  }

  throw new BackendError("UNKNOWN_PROVIDER", provider);
}

async function signOut(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  await supabase.auth.signOut();
}

export function useAuthActions(): {
  signIn: (provider: string, params?: SignInParams) => Promise<void>;
  signOut: () => Promise<void>;
} {
  return useMemo(() => ({ signIn, signOut }), []);
}

/** Compatibility shim for the one page that grabbed the Convex client. */
export function useConvex(): {
  query: (ref: unknown, args?: unknown) => Promise<unknown>;
  mutation: (ref: unknown, args?: unknown) => Promise<unknown>;
  action: (ref: unknown, args?: unknown) => Promise<unknown>;
} {
  return useMemo(
    () => ({
      query: async (ref: unknown, args?: unknown) => callBackend(ref, args),
      mutation: async (ref: unknown, args?: unknown) => {
        const result = await callBackend(ref, args);
        const mutationName = typeof ref === "string" ? ref : refToKey(ref);
        bump({ mutationName });
        return result;
      },
      action: async (ref: unknown, args?: unknown) => {
        const result = await callBackend(ref, args);
        const actionName = typeof ref === "string" ? ref : refToKey(ref);
        bump({ mutationName: actionName });
        return result;
      },
    }),
    []
  );
}

/* ---------------------------------------------------- test-only exports -- */

export const __test_queryCache = {
  size: () => inFlightQueries.size,
  has: (key: string) => inFlightQueries.has(key),
  clear: () => inFlightQueries.clear(),
};

export const __test_invalidationBus = {
  subscribe,
  bump,
  reset: () => {
    version = 0;
    listenerEntries.clear();
  },
  listenerCount: () => listenerEntries.size,
  getTablesForQuery,
  getTablesForMutation,
};
