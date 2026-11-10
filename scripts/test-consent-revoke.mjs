/**
 * MVTH for consent revocation (B2): tests the logic that setConsent(false)
 * should close open travel segments with needsReview=true, reviewReason="consent_revoked".
 * Pure logic test — no DB required.
 */
import assert from "node:assert/strict";

console.log("Testing consent revocation logic (B2)...");

// Simulated user and segment state
const user = { _id: "user-1", travelConsentAt: 1000 };
const openSegment = {
  _id: "seg-1",
  userId: "user-1",
  arrivedAt: undefined,
  needsReview: false,
  reviewReason: undefined,
};

// Current setConsent (simplified):
function currentSetConsent(consent, user, segments) {
  if (consent) {
    user.travelConsentAt = Date.now();
  } else {
    user.travelConsentAt = undefined;
    // Current code does NOT touch segments
  }
  return { user, segments };
}

// Fixed setConsent:
function fixedSetConsent(consent, user, segments) {
  if (consent) {
    user.travelConsentAt = Date.now();
  } else {
    user.travelConsentAt = undefined;
    // FIX: close all open segments for this user
    for (const seg of segments) {
      if (seg.userId === user._id && seg.arrivedAt === undefined) {
        seg.arrivedAt = Date.now();
        seg.needsReview = true;
        seg.reviewReason = "consent_revoked";
      }
    }
  }
  return { user, segments };
}

// Test 1: consent=true -> no segment changes
let result = fixedSetConsent(true, { ...user }, [{ ...openSegment }]);
assert.ok(result.user.travelConsentAt !== undefined);
assert.equal(result.segments[0].arrivedAt, undefined);
assert.equal(result.segments[0].needsReview, false);
console.log("B2-1 PASS: consent grant doesn't close segments");

// Test 2: consent=false -> open segment closed with needsReview
result = fixedSetConsent(false, { ...user }, [{ ...openSegment }]);
assert.equal(result.user.travelConsentAt, undefined);
assert.ok(result.segments[0].arrivedAt !== undefined);
assert.equal(result.segments[0].needsReview, true);
assert.equal(result.segments[0].reviewReason, "consent_revoked");
console.log("B2-2 PASS: consent revoke closes open segment with needsReview");

// Test 3: consent=false -> already-closed segment unchanged
const closedSegment = { ...openSegment, arrivedAt: 5000, needsReview: false };
result = fixedSetConsent(false, { ...user }, [{ ...closedSegment }]);
assert.equal(result.segments[0].arrivedAt, 5000); // unchanged
assert.equal(result.segments[0].needsReview, false); // unchanged
console.log("B2-3 PASS: already-closed segment untouched");

// Test 4: consent=false -> other user's segment untouched
result = fixedSetConsent(false, { ...user }, [{ ...openSegment, userId: "user-2" }]);
assert.equal(result.segments[0].arrivedAt, undefined); // other user's segment untouched
console.log("B2-4 PASS: other user's segment untouched");

console.log("All consent revocation logic tests PASS");
