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

/* ------------------------------------------------------- invalidation bus -- */

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------- transport -- */

async function accessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function callBackend(ref: unknown, args?: unknown): Promise<unknown> {
  const token = await accessToken();
  const response = await fetch("/api/backend/call", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ref: refToKey(ref), args: args ?? {} }),
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
}

/* ------------------------------------------------------------------ hooks -- */

type QueryState = { key: string; data: unknown; error: Error | null };

export function useQuery<T = any>(
  ref: FunctionRef | string,
  args?: Record<string, unknown> | "skip"
): T | undefined {
  const skip = args === "skip";
  const key = skip ? "" : `${refToKey(ref)}::${JSON.stringify(args ?? {})}`;
  const [tick, setTick] = useState(version);
  const [state, setState] = useState<QueryState>({ key: "", data: undefined, error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => subscribe(() => setTick(version)), []);

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
        console.warn("[backend] query failed", refToKey(ref), resolved.message);
        setState({ key, data: undefined, error: resolved });
      });
    return () => {
      active = false;
    };
  }, [key, tick, skip, ref, args]);

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
      bump();
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
      bump();
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
        bump();
        return result;
      },
      action: async (ref: unknown, args?: unknown) => {
        const result = await callBackend(ref, args);
        bump();
        return result;
      },
    }),
    []
  );
}
