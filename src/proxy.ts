import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 proxy (the middleware.ts convention is deprecated in 16).
 *
 * Only Supabase session refresh happens here; route matching is limited to
 * document/API requests so static assets never pay for an auth round-trip.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip Next internals and static files:
     * _next/static, _next/image, favicon.ico, and common image/font assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
