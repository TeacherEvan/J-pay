/**
 * Test-only module loader for React components that talk to the backend.
 *
 * Why this exists: `src/app/**` components import `@/lib/backend/react`, which
 * pulls in the Supabase browser client and the whole adapter graph. A unit
 * test that wants to drive one component's event handler should not need a
 * browser, a Supabase URL or a network. This loader resolves `@/…` aliases,
 * transpiles `.ts`/`.tsx` on the fly, and swaps three modules for in-memory
 * stubs:
 *
 *   @/lib/backend/react   → useMutation/useQuery driven by globalThis.__mockMutations
 *   @/lib/backend/api     → a proxy that yields `{ module, fn }` refs
 *   @/lib/supabase/client → a no-op auth client
 *
 * Everything else (the component, the outbox, the clock, the error helpers) is
 * the real code under test. Used by scripts/test-checkin-busy-latch.mjs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import ts from "typescript";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const p = (...segments) => path.join(ROOT, ...segments);
const firstReadable = (candidates) =>
  candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });

const STUBS = {
  "@/lib/backend/react": `
    export function useMutation(ref) {
      const fn = globalThis.__mockMutations?.[ref.fn];
      return async (args) => {
        if (!fn) throw new Error("no mock for " + ref.fn);
        return fn(args);
      };
    }
    export function useQuery() { return undefined; }
    export function useQueryResult() { return { data: undefined, error: null, isLoading: false, retry: () => {} }; }
    export function useAuthActions() { return { signIn: async () => {} }; }
    export function useConvexAuth() { return { isLoading: false, isAuthenticated: false }; }
    export function useSessionState() { return { loading: false, user: null }; }
  `,
  "@/lib/backend/api": `
    export const api = new Proxy({}, { get: (_t, module) => new Proxy({}, { get: (_i, fn) => ({ module, fn }) }) });
  `,
  "@/lib/supabase/client": `
    export function getSupabaseBrowserClient() {
      return { auth: { getSession: async () => ({ data: { session: null } }), signOut: async () => {} } };
    }
    export function resetSupabaseBrowserClient() {}
  `,
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return {
      url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]),
      shortCircuit: true,
      format: "module",
    };
  }
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true, format: "module" };
  }
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const hit = firstReadable([
      p("src", relative + ".ts"),
      p("src", relative + ".tsx"),
      p("src", relative, "index.ts"),
    ]);
    if (hit) return { url: "file://" + hit, shortCircuit: true, format: "module" };
  }
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL).pathname;
    const hit = firstReadable([
      base + ".ts",
      base + ".tsx",
      base + ".js",
      path.join(base, "index.ts"),
    ]);
    if (hit) return { url: "file://" + hit, shortCircuit: true, format: "module" };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
      },
      fileName: path.basename(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
