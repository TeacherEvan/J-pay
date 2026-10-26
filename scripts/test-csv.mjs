import assert from "node:assert";
import { sanitizeCell, toCsv } from "../src/lib/csv.ts";

assert.equal(sanitizeCell("=SUM(A1)"), "'=SUM(A1)");
assert.equal(sanitizeCell("+1234"), "'+1234");
assert.equal(sanitizeCell("-cmd"), "'-cmd");
assert.equal(sanitizeCell("@evil"), "'@evil");
assert.equal(sanitizeCell("\tTab"), "'\tTab");
assert.equal(sanitizeCell("Ewaldt"), "Ewaldt");
assert.equal(sanitizeCell("2026-08-24T10:00:00Z"), "2026-08-24T10:00:00Z");
assert.equal(sanitizeCell(""), "");
assert.equal(sanitizeCell(null), "");
assert.equal(sanitizeCell(-26.2041), "-26.2041");
assert.equal(sanitizeCell(-12), "-12");
assert.equal(sanitizeCell("\n=1+1"), "'\n=1+1");
assert.equal(sanitizeCell("  =1+1"), "'  =1+1");

const csv = toCsv(["name", "note"], [["ok", "=HYPERLINK(\"http://x\")"], ["a\"b", 42]]);
assert.ok(csv.startsWith('"name","note"'));
assert.ok(csv.includes("'=HYPERLINK"));
assert.ok(csv.includes('"a""b"'));

console.log("CSV GUARD TESTS PASS");
