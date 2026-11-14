/**
 * Supabase environment resolution.
 *
 * Values live in `.env.local` (git-ignored). Next.js only loads files that
 * start with a dot (`.env`, `.env.local`, `.env.<NODE_ENV>`) — a bare
 * `env.local` is NOT read, so keep the real values in `.env.local`.
 *
 * Every `process.env.NEXT_PUBLIC_*` reference below is a static member
 * expression on purpose: that is what lets the Next.js compiler inline the
 * value into the browser bundle. Never rewrite these as `process.env[name]`.
 */

const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const RAW_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type SupabaseEnv = {
  /** Project base URL, e.g. https://<ref>.supabase.co */
  url: string;
  /** Publishable (formerly anon) key — safe to ship to the browser. */
  key: string;
  /** Project ref parsed out of the URL, e.g. dlwlbvhyrvyftpjruqdq. */
  ref: string;
};

function projectRefFromUrl(url: string): string {
  const host = url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return host.split(".")[0] ?? "";
}

/** True when both public values are present — safe to call anywhere. */
export function hasSupabaseEnv(): boolean {
  return Boolean(RAW_URL && RAW_PUBLISHABLE_KEY);
}

/**
 * Returns the resolved public config, or throws an actionable error.
 * Throwing beats returning a half-built client that fails with an opaque 401.
 */
export function readSupabaseEnv(): SupabaseEnv {
  const missing = [
    ...(RAW_URL ? [] : ["NEXT_PUBLIC_SUPABASE_URL"]),
    ...(RAW_PUBLISHABLE_KEY
      ? []
      : ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)"]),
  ];

  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing in .env.local: ${missing.join(", ")}. ` +
        "Copy the values from the Supabase dashboard → Project Settings → API keys."
    );
  }

  return {
    url: RAW_URL as string,
    key: RAW_PUBLISHABLE_KEY as string,
    ref: projectRefFromUrl(RAW_URL as string),
  };
}

/** Redacted descriptor for logs and health output — never returns the key. */
export function describeSupabaseEnv(): {
  configured: boolean;
  url: string | null;
  ref: string | null;
  keyKind: "publishable" | "legacy-anon" | "missing";
} {
  if (!RAW_URL || !RAW_PUBLISHABLE_KEY) {
    return { configured: false, url: RAW_URL ?? null, ref: null, keyKind: "missing" };
  }
  return {
    configured: true,
    url: RAW_URL,
    ref: projectRefFromUrl(RAW_URL),
    keyKind: RAW_PUBLISHABLE_KEY.startsWith("sb_publishable_")
      ? "publishable"
      : "legacy-anon",
  };
}
