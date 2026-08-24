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

const csv = toCsv(["name", "note"], [["ok", "=HYPERLINK(\"http://x\")"], ["a\"b", 42]]);
assert.ok(csv.startsWith('"name","note"'));
assert.ok(csv.includes("'=HYPERLINK"));
assert.ok(csv.includes('"a""b"'));

console.log("CSV GUARD TESTS PASS");
