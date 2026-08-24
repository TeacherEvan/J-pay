const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64url(new Uint8Array(mac));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueDeviceToken(
  userId: string,
  secret: string
): Promise<{ token: string; issuedAt: number }> {
  const issuedAt = Date.now();
  const payload = `${userId}:${issuedAt}`;
  return { token: `${issuedAt}.${await sign(payload, secret)}`, issuedAt };
}

export async function verifyDeviceToken(
  token: string,
  userId: string,
  secret: string,
  storedIssuedAt: string | undefined
): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0 || !storedIssuedAt) return false;
  const issuedAtStr = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (issuedAtStr !== storedIssuedAt) return false;
  return safeEqual(mac, await sign(`${userId}:${issuedAtStr}`, secret));
}
