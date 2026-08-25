// scripts/e2e-demo-rich.mjs
//
// v3 acceptance — Puppeteer walkthrough of the /demo console.

import puppeteer from "puppeteer-core";

const BASE = process.env.JPAY_BASE_URL ?? "http://localhost:3000";
const b = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9300",
  defaultViewport: null,
  protocolTimeout: 90000,
});
for (const pg of await b.pages()) await pg.close().catch(() => {});
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => p.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
const clickByText = (label) => p.evaluate((l) => {
  for (const sel of ["button", "a"]) {
    const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(l));
    if (el) { el.click(); return true; }
  }
  return false;
}, label);
const clickByTestId = (id) => p.evaluate((sel) => {
  const el = document.querySelector(`[data-testid="${sel}"]`);
  if (el) { el.click(); return true; }
  return false;
}, id);

let ok = true;
const check = (cond, label, detail = "") => {
  if (!cond) ok = false;
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
};

try {
  await p.goto(BASE + "/", { waitUntil: "networkidle2" });
  let t = "";
  for (let i = 0; i < 20; i++) {
    t = await text();
    if (/J-Pay/.test(t)) break;
    await sleep(1500);
  }
  check(/J-Pay/.test(t), "port-collision sentinel: J-Pay served", BASE);

  let demoClicked = false;
  for (let i = 0; i < 20 && !demoClicked; i++) {
    demoClicked = await clickByText("Enter demo preview");
    if (!demoClicked) await sleep(1500);
  }
  check(demoClicked, "clicked 'Enter demo preview'");

  let onDemo = false;
  for (let i = 0; i < 30; i++) {
    if (p.url().includes("/demo")) { onDemo = true; break; }
    await sleep(1000);
  }
  check(onDemo, "redirected to /demo", p.url());

  try {
    await p.waitForSelector('[data-testid="demo-persona-header"]', { timeout: 30000 });
    check(true, "persona header rendered");
  } catch (e) {
    check(false, "persona header rendered", (await text()).slice(0, 200));
  }

  await sleep(2500);

  const counts = await p.evaluate(() => ({
    kpi: document.querySelectorAll('[data-testid="kpi-card"]').length,
    audit: document.querySelectorAll('[data-testid="audit-log-row"]').length,
    payroll: document.querySelectorAll('[data-testid="payroll-day-row"]').length,
    review: document.querySelectorAll('[data-testid="needs-review-row"]').length,
  }));
  check(counts.kpi >= 4, `≥4 KPI cards (got ${counts.kpi})`);
  check(counts.audit >= 5, `≥5 audit rows (got ${counts.audit})`);
  check(counts.payroll >= 5, `≥5 payroll day rows (got ${counts.payroll})`);
  check(counts.review >= 1, `≥1 needs-review row (got ${counts.review})`);

  const kpiTexts = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid="kpi-card"] p:nth-of-type(2)')].map(x => x.textContent.trim())
  );
  const nonZeroKpi = kpiTexts.filter((v) => v && v !== "0" && v !== "—" && v !== "0h 00m");
  check(nonZeroKpi.length >= 1, `≥1 non-zero KPI value (values: ${JSON.stringify(kpiTexts)})`);

  await clickByText("Switch persona");
  let onPersona = false;
  for (let i = 0; i < 15; i++) {
    if (p.url().includes("/demo/persona")) { onPersona = true; break; }
    await sleep(1000);
  }
  check(onPersona, "navigated to /demo/persona", p.url());

  const siphoClicked = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="persona-row"]')];
    const siphoRow = rows.find((r) => /Sipho/.test(r.textContent));
    const btn = siphoRow?.querySelector('[data-testid="persona-play-button"]');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
  check(siphoClicked, "clicked 'Play as' on Sipho");

  let backToDemo = false;
  for (let i = 0; i < 15; i++) {
    if (p.url().endsWith("/demo") || p.url().endsWith("/demo/")) { backToDemo = true; break; }
    await sleep(1000);
  }
  check(backToDemo, "redirected back to /demo", p.url());
  await sleep(3000);

  let personaName = "";
  for (let i = 0; i < 20; i++) {
    personaName = await p.evaluate(() =>
      document.querySelector('[data-testid="demo-persona-name"]')?.textContent?.trim() ?? ""
    );
    if (/Sipho/i.test(personaName)) break;
    await sleep(1000);
  }
  check(/Sipho/i.test(personaName), `persona header now shows Sipho (got "${personaName}")`);

  const auditAfter = await p.evaluate(() => document.querySelectorAll('[data-testid="audit-log-row"]').length);
  check(auditAfter >= 1, `audit log has ≥1 row after switch (got ${auditAfter})`);

  const checkedIn = await clickByTestId("demo-checkin-button");
  check(checkedIn, "clicked 'CHECK IN as persona'");
  let msg = "";
  for (let i = 0; i < 15; i++) {
    msg = await p.evaluate(() =>
      document.querySelector('[data-testid="demo-checkin-message"]')?.textContent?.trim() ?? ""
    );
    if (/Logged|denied|Weak/i.test(msg)) break;
    await sleep(1500);
  }
  check(/Logged|denied|Weak/i.test(msg), `check-in message appeared (got "${msg}")`);

  const downloadDir = process.env.JPAY_DOWNLOAD_DIR ?? "/tmp/opencode";
  const cdp = await p.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }).catch(() => {});
  const exportClicked = await clickByText("Download CSV");
  check(exportClicked, "clicked 'Download CSV'");
  let csvFound = false;
  let csvSize = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const { readdirSync, statSync } = await import("node:fs");
    const files = readdirSync(downloadDir).filter((f) => /^jpay-logs-demo-.*\.csv$/.test(f));
    if (files.length > 0) {
      const f = files.sort().pop();
      const stat = statSync(`${downloadDir}/${f}`);
      csvSize = stat.size;
      if (csvSize > 0) { csvFound = true; break; }
    }
  }
  check(csvFound && csvSize > 0, `CSV downloaded and non-empty (size=${csvSize}B)`);

  await p.screenshot({ path: `user-review/demo-rich-${Date.now()}.png` });

  const exitClicked = await clickByText("Exit demo");
  check(exitClicked, "clicked 'Exit demo'");
  let backToRoot = false;
  for (let i = 0; i < 15; i++) {
    const u = p.url();
    if (u === BASE + "/" || u === BASE) { backToRoot = true; break; }
    await sleep(1000);
  }
  check(backToRoot, "navigated back to /", p.url());
} finally {
  if (errors.length) { ok = false; console.log("PAGE ERRORS:", [...new Set(errors)].slice(0, 4).join(" || ")); }
  await p.close().catch(() => {});
  await b.disconnect();
}

console.log(ok ? "DEMO RICH: ALL PASS" : "DEMO RICH: FAILURES");
process.exit(ok ? 0 : 1);
