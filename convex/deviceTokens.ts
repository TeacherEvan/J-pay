import { createHmac, timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

function b64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(Buffer.from(ab), Buffer.from(bb));
}

export function issueDeviceToken(userId: string, secret: string): { token: string; issuedAt: number } {
  const issuedAt = Date.now();
  const payload = `${userId}:${issuedAt}`;
  return { token: `${issuedAt}.${sign(payload, secret)}`, issuedAt };
}

export function verifyDeviceToken(
  token: string,
  userId: string,
  secret: string,
  storedIssuedAt: string | undefined
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0 || !storedIssuedAt) return false;
  const issuedAtStr = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (issuedAtStr !== storedIssuedAt) return false;
  return safeEqual(mac, sign(`${userId}:${issuedAtStr}`, secret));
}
