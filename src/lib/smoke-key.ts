import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret gate for the smoke/diagnostic endpoint GET /api/backend/call.
 * In production the function inventory (including internal handlers) is not
 * public information. Constant-time compare; both sides required.
 */
export function isSmokeKeyValid(headerValue: string | null | undefined, expectedKey: string | undefined): boolean {
  if (!expectedKey || !headerValue) return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(expectedKey, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
