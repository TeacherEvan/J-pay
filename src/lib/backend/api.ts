"use client";

/**
 * Client-side function references.
 *
 * `api.users.me` used to be a Convex generated reference; it is now a plain
 * `{ module, fn }` descriptor that /api/backend/call understands. Keeping the
 * same shape means the 60-odd call sites in src/app did not change.
 */

export type FunctionRef = { module: string; fn: string };

function makeNamespace(): Record<string, Record<string, unknown>> {
  return new Proxy({} as Record<string, Record<string, unknown>>, {
    get(_target, moduleName: string) {
      return new Proxy({} as Record<string, unknown>, {
        get(_inner, fn: string) {
          return { module: moduleName, fn };
        },
      });
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = makeNamespace();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const internal: any = makeNamespace();

export function refToKey(ref: unknown): string {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object") {
    const maybe = ref as Partial<FunctionRef> & { module?: string; fn?: string };
    if (maybe.module && maybe.fn) return `${maybe.module}:${maybe.fn}`;
  }
  throw new Error("Invalid function reference");
}
