import assert from "node:assert/strict";
import {
  getPayStrategy,
  listSupportedJurisdictions,
  UnsupportedJurisdictionError,
} from "../src/lib/payroll-jurisdictions.ts";

{
  const j = getPayStrategy("ZA");
  assert.equal(j.strategy, "bcea");
  assert.equal(j.currency, "ZAR");
  assert.equal(j.currencySymbol, "R");
  assert.equal(j.defaultTimezone, "Africa/Johannesburg");
  assert.equal(j.displayName, "South Africa (BCEA)");
}

{
  const j = getPayStrategy("us");
  assert.equal(j.strategy, "flsa");
  assert.equal(j.currency, "USD");
  assert.equal(j.currencySymbol, "$");
  assert.equal(j.defaultTimezone, "America/New_York");
}

{
  const j = getPayStrategy("UK");
  assert.equal(j.strategy, "wtr_uk");
  assert.equal(j.currency, "GBP");
  assert.equal(j.currencySymbol, "£");
  assert.equal(j.defaultTimezone, "Europe/London");
}

assert.throws(
  () => getPayStrategy("DE"),
  (e) => e instanceof UnsupportedJurisdictionError && e.code === "DE"
);

{
  const list = listSupportedJurisdictions();
  assert.equal(list.length, 3);
  const codes = list.map((j) => j.code).sort();
  assert.deepEqual(codes, ["UK", "US", "ZA"]);
}

console.log("payroll-jurisdictions: all assertions passed");
