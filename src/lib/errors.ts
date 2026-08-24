export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Uncaught Error: /, "");
}
