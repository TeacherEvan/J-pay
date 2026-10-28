import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, readSupabaseEnv } from "./env";

/**
 * Refresh the Supabase auth session for an incoming request.
 *
 * This is the only place that should call `supabase.auth.getUser()` on every
 * request: it validates the JWT and, when the access token is near expiry,
 * writes refreshed cookies onto the response. Server Components cannot write
 * cookies, so without this the session silently expires between navigations.
 *
 * Keep the createServerClient -> getUser() window free of other logic: the
 * Supabase SSR docs are explicit that anything in between can cause hard-to-
 * trace random logouts.
 */
export async function updateSession(request: NextRequest) {
  // Supabase is the live backend now, but an unconfigured checkout must still
  // boot (and the health route explains what is missing), so skip cleanly.
  if (!hasSupabaseEnv()) {
    return NextResponse.next({ request });
  }

  const { url, key, ref } = readSupabaseEnv();

  // No Supabase session cookie means there is nothing to refresh. Skipping the
  // client (and its network round-trip) keeps signed-out pages fast.
  const hasSessionCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith(`sb-${ref}-auth-token`));
  if (!hasSessionCookie) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}
