import assert from "node:assert/strict";
import { isSmokeKeyValid } from "../src/lib/smoke-key.ts";

assert.equal(isSmokeKeyValid("s3cret-key", "s3cret-key"), true, "exact match passes");
assert.equal(isSmokeKeyValid("s3cret-kez", "s3cret-key"), false, "same length, wrong content fails");
assert.equal(isSmokeKeyValid("short", "s3cret-key-longer"), false, "different length fails");
assert.equal(isSmokeKeyValid(null, "s3cret-key"), false, "missing header fails");
assert.equal(isSmokeKeyValid("s3cret-key", undefined), false, "no configured key fails closed");
assert.equal(isSmokeKeyValid("", ""), false, "empty pair fails even though both empty");
assert.equal(isSmokeKeyValid("ééé", "ééé"), true, "multibyte exact match passes");
console.log("smoke key OK");
