// scripts/e2e-demo-rich.mjs
//
// v3 acceptance — Puppeteer walkthrough of the /demo console.

import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  runWithBrowser,
  clickByText,
  clickByTestId,
  waitForText,
  waitForTestId,
  waitForDownload,
  assertJPayServed,
} from "./e2e-helpers.mjs";

const DOWNLOAD_DIR = process.env.JPAY_DOWNLOAD_DIR ?? "/tmp/opencode";

let ok = true;
const check = (cond, label, detail = "") => {
  if (!cond) ok = false;
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
};

await runWithBrowser(async (page) => {
  check(await assertJPayServed(page, process.env.JPAY_BASE_URL ?? "http://localhost:3000"), "port-collision sentinel: J-Pay served", process.env.JPAY_BASE_URL ?? "http://localhost:3000");

  let demoClicked = false;
  for (let i = 0; i < 20 && !demoClicked; i++) {
    demoClicked = await clickByTestId(page, "demo-preview-cta");
    if (!demoClicked) await new Promise((r) => setTimeout(r, 1500));
  }
  check(demoClicked, "clicked 'Enter demo preview'");

  let onDemo = false;
  for (let i = 0; i < 30; i++) {
    if (page.url().includes("/demo")) { onDemo = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(onDemo, "redirected to /demo", page.url());

  try {
    await waitForTestId(page, "demo-persona-header", { timeoutMs: 30_000 });
    check(true, "persona header rendered");
  } catch (e) {
    check(false, "persona header rendered", (await page.evaluate(() => document.body.innerText)).slice(0, 200));
  }

  await new Promise((r) => setTimeout(r, 2500));

  const counts = await page.evaluate(() => ({
    kpi: document.querySelectorAll('[data-testid="kpi-card"]').length,
    audit: document.querySelectorAll('[data-testid="audit-log-row"]').length,
    payroll: document.querySelectorAll('[data-testid="payroll-day-row"]').length,
    review: document.querySelectorAll('[data-testid="needs-review-row"]').length,
  }));
  check(counts.kpi >= 4, `≥4 KPI cards (got ${counts.kpi})`);
  check(counts.audit >= 5, `≥5 audit rows (got ${counts.audit})`);
  check(counts.payroll >= 5, `≥5 payroll day rows (got ${counts.payroll})`);
  check(counts.review >= 1, `≥1 needs-review row (got ${counts.review})`);

  const kpiTexts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="kpi-card"] p:nth-of-type(2)')].map((x) => x.textContent.trim()),
  );
  const nonZeroKpi = kpiTexts.filter((v) => v && v !== "0" && v !== "—" && v !== "0h 00m");
  check(nonZeroKpi.length >= 1, `≥1 non-zero KPI value (values: ${JSON.stringify(kpiTexts)})`);

  await clickByText(page, "Switch persona");
  let onPersona = false;
  for (let i = 0; i < 15; i++) {
    if (page.url().includes("/demo/persona")) { onPersona = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(onPersona, "navigated to /demo/persona", page.url());

  const siphoClicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="persona-row"]')];
    const siphoRow = rows.find((r) => /Sipho/.test(r.textContent));
    const btn = siphoRow?.querySelector('[data-testid="persona-play-button"]');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
  check(siphoClicked, "clicked 'Play as' on Sipho");

  let backToDemo = false;
  for (let i = 0; i < 15; i++) {
    if (page.url().endsWith("/demo") || page.url().endsWith("/demo/")) { backToDemo = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(backToDemo, "redirected back to /demo", page.url());
  await new Promise((r) => setTimeout(r, 3000));

  let personaName = "";
  for (let i = 0; i < 20; i++) {
    personaName = await page.evaluate(() =>
      document.querySelector('[data-testid="demo-persona-name"]')?.textContent?.trim() ?? "",
    );
    if (/Sipho/i.test(personaName)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(/Sipho/i.test(personaName), `persona header now shows Sipho (got "${personaName}")`);

  const auditAfter = await page.evaluate(() => document.querySelectorAll('[data-testid="audit-log-row"]').length);
  check(auditAfter >= 1, `audit log has ≥1 row after switch (got ${auditAfter})`);

  const checkedIn = await clickByTestId(page, "demo-checkin-button");
  check(checkedIn, "clicked 'CHECK IN as persona'");
  let msg = "";
  for (let i = 0; i < 15; i++) {
    msg = await page.evaluate(() =>
      document.querySelector('[data-testid="demo-checkin-message"]')?.textContent?.trim() ?? "",
    );
    if (/Logged|denied|Weak/i.test(msg)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  check(/Logged|denied|Weak/i.test(msg), `check-in message appeared (got "${msg}")`);

  const exportClicked = await clickByText(page, "Download CSV");
  check(exportClicked, "clicked 'Download CSV'");
  let csvFound = false;
  let csvSize = 0;
  try {
    const { size, name } = await waitForDownload({
      downloadDir: DOWNLOAD_DIR,
      matcher: /^jpay-logs-demo-.*\.csv$/,
      minBytes: 1,
      settleMs: 500,
      timeoutMs: 20_000,
    });
    csvFound = true;
    csvSize = size;
  } catch {
    // fall back to the legacy "any matching file in dir" check
    const files = readdirSync(DOWNLOAD_DIR).filter((f) => /^jpay-logs-demo-.*\.csv$/.test(f));
    if (files.length > 0) {
      const f = files.sort().pop();
      const stat = statSync(resolve(DOWNLOAD_DIR, f));
      csvSize = stat.size;
      csvFound = csvSize > 0;
    }
  }
  check(csvFound && csvSize > 0, `CSV downloaded and non-empty (size=${csvSize}B)`);

  await page.screenshot({ path: `user-review/demo-rich-${Date.now()}.png` });

  const exitClicked = await clickByText(page, "Exit demo");
  check(exitClicked, "clicked 'Exit demo'");
  let backToRoot = false;
  for (let i = 0; i < 15; i++) {
    const u = page.url();
    if (u === (process.env.JPAY_BASE_URL ?? "http://localhost:3000") + "/" || u === (process.env.JPAY_BASE_URL ?? "http://localhost:3000")) { backToRoot = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(backToRoot, "navigated back to /", page.url());
}, { downloadDir: DOWNLOAD_DIR });

console.log(ok ? "DEMO RICH: ALL PASS" : "DEMO RICH: FAILURES");
process.exit(ok ? 0 : 1);
