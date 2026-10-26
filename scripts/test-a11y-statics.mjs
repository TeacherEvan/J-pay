import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_APP = "src/app";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function slurp(path) {
  return readFileSync(path, "utf8");
}

const files = walk(SRC_APP);
const fileByPath = Object.fromEntries(files.map((f) => [f, slurp(f)]));

test("a11y-statics: no text-[10px] or text-[11px] remain in src/app/", () => {
  const offenders = files.filter((f) => /text-\[(10|11)px\]/.test(fileByPath[f]));
  assert.deepEqual(
    offenders,
    [],
    `WCAG 1.4.4: text below 12px is too small. Found in:\n${offenders.join("\n")}`,
  );
});

test("a11y-statics: every <input placeholder= in moderator page has a sibling <label>", () => {
  const f = "src/app/moderator/page.tsx";
  const src = fileByPath[f];
  const labelIds = new Set();
  for (const m of src.matchAll(/<label[^>]*htmlFor=["']([^"']+)["']/g)) {
    labelIds.add(m[1]);
  }
  const offenders = [];
  for (const m of src.matchAll(/<input\b([^>]*)\bplaceholder=/g)) {
    const attrs = m[1];
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
    const id = idMatch ? idMatch[1] : null;
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    const wrapped = /<label[\s>][^<]*$/.test(before) && !/<\/label>/.test(before);
    if (!id && !wrapped) {
      offenders.push(`${m[0]}`);
    } else if (id && !labelIds.has(id)) {
      offenders.push(`<input id="${id}"> has no <label htmlFor="${id}">`);
    }
  }
  assert.deepEqual(offenders, [], `WCAG 1.3.1: F9 inputs need labels. Offenders:\n${offenders.join("\n")}`);
});

test("a11y-statics: geofence-modal.tsx imports useRef/useEffect and has keydown focus trap", () => {
  const f = "src/app/moderator/geofence-modal.tsx";
  const src = fileByPath[f];
  assert.ok(/import\s*\{[^}]*\buseRef\b[^}]*\}\s*from\s*["']react["']/.test(src), `${f}: must import useRef`);
  assert.ok(/import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*["']react["']/.test(src), `${f}: must import useEffect`);
  assert.ok(/addEventListener\(["']keydown["']/.test(src), `${f}: must bind a keydown handler`);
  assert.ok(/role=["']dialog["']/.test(src), `${f}: must declare role="dialog"`);
  assert.ok(/aria-modal=["']true["']/.test(src), `${f}: must declare aria-modal`);
});

test("a11y-statics: change-password.tsx has no setTimeout in the success-render path", () => {
  const f = "src/app/change-password.tsx";
  const src = fileByPath[f];
  const successBranch = src.match(/saved\s*\?\s*\([\s\S]*?\)\s*:\s*\(/);
  if (successBranch) {
    const branch = successBranch[0];
    assert.ok(
      !/setTimeout\(/.test(branch),
      `${f}: setTimeout must not run during the success-branch render`,
    );
  }
  if (src.includes("useEffect")) {
    assert.ok(
      /useEffect\([\s\S]*?setTimeout\([\s\S]*?window\.location\.reload[\s\S]*?\[saved\]/.test(src),
      `${f}: expected a useEffect that schedules the reload on saved`,
    );
  }
});

test("a11y-statics: status pill row in check-in-card.tsx is a radiogroup with aria-checked", () => {
  const f = "src/app/check-in-card.tsx";
  const src = fileByPath[f];
  assert.ok(/role=["']radiogroup["']/.test(src), `${f}: status row must be a radiogroup`);
  assert.ok(/aria-checked=/.test(src), `${f}: each pill must have aria-checked`);
  assert.ok(/role=["']radio["']/.test(src), `${f}: each pill must have role="radio"`);
  assert.ok(/tabIndex=\{pending === s \? 0 : -1\}/.test(src), `${f}: pills must use roving tabindex (0 on selected, -1 elsewhere)`);
  assert.ok(/onKeyDown=/.test(src), `${f}: radiogroup must have onKeyDown handler for arrow keys`);
});
