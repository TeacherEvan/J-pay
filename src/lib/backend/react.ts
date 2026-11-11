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
  | "organisations"
  | "sites"
  | "punches"
  | "userSites"
  | "logs"
  | "shifts"
  | "messages"
  | "pushSubscriptions"
  | "purgeAudit"
  | "reviewResolutions"
  | "demoSessions"
  | "managerSites"
  | "travelSegments"
  | "shiftOverrides";

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
  // The server reports each mutation's write-set (`tables`); there is no
  // hand-maintained client map anymore (audit 2026-11-11, P2-5). A bare
  // mutationName carries no table information here → notify everyone.
  if (event?.tables && event.tables.length > 0) {
    affectedTables = event.tables;
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

export function callBackend(
  ref: unknown,
  args?: unknown,
  meta?: { tablesWritten?: string[]; tablesRead?: string[] }
): Promise<unknown> {
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

    let payload: { result?: unknown; error?: string; message?: string; tables?: string[]; reads?: string[] } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // non-JSON error page
    }

    if (meta) {
      meta.tablesWritten = Array.isArray(payload.tables) ? payload.tables : undefined;
      meta.tablesRead = Array.isArray(payload.reads) ? payload.reads : undefined;
    }
    if (!response.ok) {
      throw new BackendError(payload.error ?? "INTERNAL", payload.message);
    }
    // Invalidation is the caller's job (mutation hooks bump from the
    // server-reported write-set; queries subscribe to their own reads).
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

  const callMeta = useRef<{ tablesWritten?: string[]; tablesRead?: string[] }>({});
  // undefined = unknown yet (or old server) → wildcard subscription.
  const [reads, setReads] = useState<readonly string[] | undefined>(undefined);

  useEffect(() => {
    setReads(undefined);
  }, [key]);

  useEffect(() => {
    if (reads === undefined) return subscribe(null, () => setTick((v) => v + 1));
    if (reads.length === 0) return;
    return subscribe(reads, () => setTick((v) => v + 1));
  }, [reads]);

  useEffect(() => {
    if (skip) return;
    let active = true;
    callMeta.current = {};
    callBackend(ref, args, callMeta.current)
      .then((result) => {
        if (!active || !mounted.current) return;
        const learned = callMeta.current.tablesRead;
        setReads((prev) =>
          prev && learned && prev.length === learned.length && prev.every((t, i) => t === learned[i])
            ? prev
            : learned
        );
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
      const meta: { tablesWritten?: string[] } = {};
      const result = (await callBackend(ref, (args ?? {}) as unknown, meta)) as TResult;
      if (meta.tablesWritten && meta.tablesWritten.length > 0) bump({ tables: meta.tablesWritten });
      else if (meta.tablesWritten === undefined) bump(); // old server: wildcard fallback
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
      const meta: { tablesWritten?: string[] } = {};
      const result = (await callBackend(ref, (args ?? {}) as unknown, meta)) as TResult;
      if (meta.tablesWritten && meta.tablesWritten.length > 0) bump({ tables: meta.tablesWritten });
      else if (meta.tablesWritten === undefined) bump();
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
        const meta: { tablesWritten?: string[] } = {};
        const result = await callBackend(ref, args, meta);
        if (meta.tablesWritten && meta.tablesWritten.length > 0) bump({ tables: meta.tablesWritten });
        else if (meta.tablesWritten === undefined) bump();
        return result;
      },
      action: async (ref: unknown, args?: unknown) => {
        const meta: { tablesWritten?: string[] } = {};
        const result = await callBackend(ref, args, meta);
        if (meta.tablesWritten && meta.tablesWritten.length > 0) bump({ tables: meta.tablesWritten });
        else if (meta.tablesWritten === undefined) bump();
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
};
