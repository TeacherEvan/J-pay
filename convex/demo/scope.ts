import type { Doc, Id } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Demo/seed row detection — used to keep mock data out of real-moderator
// queries. See user-review/FEATURE_REVIEW.md (B2, H1) and the 2026-08-26
// owner directive: a real login must never surface seeded/demo rows.
//
// A row is considered demo/seed if ANY of these markers match:
//   users.isAnonymous === true                       (demo reviewer sessions)
//   users.email ends with ".demo@jpay.local"          (demo personas)
//   users.email starts with "e2e."                    (e2e-provisioned users)
//   users.email starts with "review-emp."             (review-provisioned users)
//   logs.deviceMetadata === "demo-seeder"             (seeder-written logs)
//   logs.createdByDemoReviewerId !== undefined        (persona check-ins)
//   sites.createdBy is a demo user                    (seeder-created sites)
// ---------------------------------------------------------------------------

const DEMO_EMAIL_SUFFIX = ".demo@jpay.local";
const E2E_EMAIL_PREFIX = "e2e.";
const REVIEW_EMP_EMAIL_PREFIX = "review-emp.";
const DEMO_DEVICE_METADATA = "demo-seeder";

export function isDemoUser(u: Doc<"users">): boolean {
  if (u.isAnonymous === true) return true;
  const email = u.email ?? "";
  if (email.endsWith(DEMO_EMAIL_SUFFIX)) return true;
  if (email.startsWith(E2E_EMAIL_PREFIX)) return true;
  if (email.startsWith(REVIEW_EMP_EMAIL_PREFIX)) return true;
  return false;
}

export function isDemoLog(l: Doc<"logs">): boolean {
  if (l.deviceMetadata === DEMO_DEVICE_METADATA) return true;
  if (l.createdByDemoReviewerId !== undefined) return true;
  return false;
}

export function isDemoSite(s: Doc<"sites">): boolean {
  // Sites are attributed to their creator; a site created by a demo user is
  // demo data. (The seeder passes createdBy = the demo reviewer's user id.)
  // We cannot resolve the user here without a db handle, so callers that
  // have one should prefer isDemoSiteWithDb.
  return false;
}

// Variant that takes a lookup function so we can resolve createdBy.
export async function isDemoSiteWithDb(
  ctx: { db: { get(id: Id<"users">): Promise<Doc<"users"> | null> } },
  s: Doc<"sites">,
): Promise<boolean> {
  const creator = await ctx.db.get(s.createdBy);
  if (!creator) return false;
  return isDemoUser(creator);
}
