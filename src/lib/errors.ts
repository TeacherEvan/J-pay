// Maps ConvexError `data` string codes (thrown from the typed action contract)
// to user-facing copy. Unknown codes fall through to the generic error message.
const TYPED_MESSAGES: Record<string, string> = {
  INVALID_CURRENT_PASSWORD: "Current password / ID code is incorrect.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Try again in a minute.",
  ACCOUNT_NOT_FOUND: "Account not found. Ask your moderator to re-provision you.",
};

export function errMsg(e: unknown): string {
  // ConvexError surfaces the data payload on `e.data`; plain Errors on `e.message`.
  // The cast is safe because TYPED_MESSAGES is keyed by string and only matches
  // when e.data is a string; everything else falls through to the generic path.
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string" && TYPED_MESSAGES[data] !== undefined) {
    return TYPED_MESSAGES[data];
  }
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Uncaught Error: /, "");
}
