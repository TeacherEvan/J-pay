import { ConvexError } from "convex/values";

export type RetrieveResult =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: unknown; user: unknown };

export function mapRetrieveResult(result: RetrieveResult): ConvexError<"ACCOUNT_NOT_FOUND" | "TOO_MANY_ATTEMPTS" | "INVALID_CURRENT_PASSWORD"> | null {
  if (typeof result === "string") {
    if (result === "InvalidSecret") return new ConvexError("INVALID_CURRENT_PASSWORD");
    if (result === "TooManyFailedAttempts") return new ConvexError("TOO_MANY_ATTEMPTS");
    if (result === "InvalidAccountId") return new ConvexError("ACCOUNT_NOT_FOUND");
  }
  return null;
}
