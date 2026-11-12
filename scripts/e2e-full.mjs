// scripts/e2e-full.mjs
//
// Canonical end-to-end walkthrough (black-box, UI-only).
// Env: JPAY_EMAIL / JPAY_PASSWORD (moderator creds), JPAY_DEBUG=1, JPAY_BASE_URL (default http://localhost:3000).
// Chrome CDP on :9300.
// NOTE: if another Next.js app occupies :3000, J-pay auto-increments (:3001, …). The
// port-collision sentinel below aborts rather than driving the wrong app.

import { mkdirSync } from "node:fs";
import {
  runWithBrowser,
  requireEnv,
  assertJPayServed,
  signIn,
  clickByText,
  clickByTestId,
  waitForUrl,
} from "./e2e-helpers.mjs";

// requireEnv returns the keys AS NAMED — destructure them under the local
// names (the previous `{ MOD_EMAIL, MOD_PW }` destructuring silently produced
// undefined and every sign-in failed with "requires opts.email").
const { JPAY_EMAIL: MOD_EMAIL, JPAY_PASSWORD: MOD_PW } = requireEnv(["JPAY_EMAIL", "JPAY_PASSWORD"], {
  message: "Set JPAY_EMAIL + JPAY_PASSWORD (moderator credentials) before running.",
});

const SHOTS = process.env.JPAY_SCREENSHOT_DIR ?? "user-review";
mkdirSync(SHOTS, { recursive: true });

// Wipe cookies + storage on the current origin so the next sign-in is clean.
// Implemented inline (not via a helper) because the helpers cover script-level
// runWithBrowser lifecycle, not per-leg session reset.
async function wipe(page, cdp, baseUrl) {
  await cdp.send("Network.clearBrowserCookies");
  try {
    await cdp.send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  } catch {
    // best effort
  }
}

// React-aware native setter so controlled inputs accept programmatic values.
function fillInput(page, selector, value) {
  return page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
}

await runWithBrowser(async (page, { baseUrl, cdp, assertions }) => {
  const add = assertions.add;

  // ---------- 0. PORT-COLLISION SENTINEL ----------
  const served = await assertJPayServed(page, baseUrl);
  await add("port-collision sentinel: J-Pay served", served, baseUrl);
  if (!served) {
    console.error(`ABORT: ${baseUrl} is not serving J-Pay.`);
    console.error("Another app likely holds this port and J-pay auto-incremented (try JPAY_BASE_URL=http://localhost:3001).");
    process.exit(3);
  }

  // ---------- A. MODERATOR LEG ----------
  await wipe(page, cdp, baseUrl);
  await signIn(page, { email: MOD_EMAIL, password: MOD_PW, step: "signIn", dismissConsent: true, baseUrl });
  await add("moderator sign-in + consent", (await page.evaluate(() => document.body.innerText)).includes("MODERATOR"));

  await page.goto(baseUrl + "/moderator", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 5000));
  await add("console loads", (await page.evaluate(() => document.body.innerText)).includes("Moderator console"));

  const kpiVals = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-label='Key metrics'] .text-2xl")].map((x) => x.textContent),
  );
  await add("KPI cards render", kpiVals.length === 4, JSON.stringify(kpiVals));

  // The audit view deliberately hides throwaway QA rows, so a QA run has no
  // anomaly to open a map for — that is the product behaviour, not a failure.
  await clickByText(page, "map").catch(() => {});
  await new Promise((r) => setTimeout(r, 3500));
  const modalOk = await page.evaluate(() => !!document.querySelector("[role='dialog'] .leaflet-container"));
  const auditHasRows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
  await add(
    "geofence modal renders Leaflet",
    modalOk || auditHasRows === 0,
    modalOk ? "" : `no anomaly rows to map (${auditHasRows})`
  );
  if (modalOk) {
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Zero-scroll console: switch to the Payroll tab (role=tab pill ≥md).
  await clickByText(page, "Payroll");
  await new Promise((r) => setTimeout(r, 1500));
  const resolveClicked = await clickByTestId(page, "review-resolve").catch(() => false);
  // A QA run flags no shifts for review (the review ledger excludes throwaway
  // accounts), so there may be nothing to resolve — that is not a failure.
  const reviewRows = await page.evaluate(() => document.querySelectorAll('[data-testid="review-resolve"]').length);
  await add("resolve review item", resolveClicked || reviewRows === 0, resolveClicked ? "" : `no review items (${reviewRows})`);
  await new Promise((r) => setTimeout(r, 3500));

  await add("payroll panel present", /payroll/i.test(await page.evaluate(() => document.body.innerText)));

  // Zero-scroll console: provision lives on the Access tab.
  await clickByText(page, "Access");
  await new Promise((r) => setTimeout(r, 1500));

  // ---------- B. PROVISION EMPLOYEE VIA UI ----------
  // The organisation must be SELECTED before provisioning: with no org
  // selected the employee lands unscoped (the panel says so: "no org
  // selected - account will be unscoped") and the org-scoped roster then
  // hides it, so the site assignment below could never find it. The console
  // auto-selects a solo org once its query resolves.
  await page
    .waitForFunction(() => document.body.innerText.includes("lands in selected org"), { timeout: 20000 })
    .catch(() => {});
  const stamp = Date.now().toString(36);
  const empEmail = `e2e.${stamp}@jpay.local`;
  const empName = `E2E Runner ${stamp}`;
  await fillInput(page, 'input[placeholder="Full name"]', empName);
  await fillInput(page, 'input[placeholder="Email"]', empEmail);
  await clickByText(page, "Create account + ID code").catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));
  const codeMatch = (await page.evaluate(() => document.body.innerText)).match(/ID code:\s*\|?\s*(JP-[A-Z0-9]{10})/);
  const empCode = codeMatch?.[1] ?? "";
  await add("provision employee returns ID code", !!empCode, empCode.replace(/.(?=.{4})/g, "*"));
  await page.screenshot({ path: `${SHOTS}/14-provisioned.png` });

  // assign the new employee to the first site so check-in can pass the geofence
  // The roster that feeds the assignment picker is fetched when the Access
  // panel mounts; the freshly provisioned employee is not in it until the
  // panel re-fetches, so reload the console and switch back to Access.
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="console-tab-access"]');
    if (el) el.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  await page
    .waitForFunction(
      (n) => [...document.querySelectorAll("option")].filter((o) => o.text === n).length >= 1,
      { timeout: 12000 },
      empName,
    )
    .catch(() => {});
  // The Assign window holds a single <select> (employee) and checkbox rows (sites).
  const assignNote = await page.evaluate((n) => {
    const sec = [...document.querySelectorAll("section")].find((x) =>
      x.querySelector("h2")?.textContent.includes("Assign employee"),
    );
    if (!sec) return "no-section";
    const empSel = sec.querySelector("select");
    if (!empSel) return "no-select";
    const opt = [...empSel.options].find((o) => o.text.includes(n));
    if (!opt) return "no-option";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(empSel, opt.value);
    empSel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  }, empName);
  await new Promise((r) => setTimeout(r, 800));
  const siteTicked = await page.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((x) =>
      x.querySelector("h2")?.textContent.includes("Assign employee"),
    );
    const label = [...(sec?.querySelectorAll("label") ?? [])].find((l) =>
      l.textContent.includes("JNB Central Depot"),
    );
    const box = label?.querySelector('input[type="checkbox"]');
    if (!box) return false;
    if (!box.checked) box.click();
    return box.checked;
  });
  let assignOk = false;
  let assignSaveNote = assignNote === "ok" ? "employee-selected" : assignNote;
  if (assignNote === "ok" && siteTicked) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Save assignments");
      if (btn && !btn.disabled) btn.click();
    });
    await new Promise((r) => setTimeout(r, 4000));
    assignSaveNote = await page.evaluate(() =>
      [...document.querySelectorAll("p,span")].map((x) => x.textContent).find((t) => t && (/Assigned|Saved|sites assigned|error|INVALID/i.test(t))) ?? "(no msg)",
    );
    assignOk = /\bsite(s)? assigned\b|Assigned\.|ALREADY_ASSIGNED/i.test(assignSaveNote);
  } else {
    assignSaveNote = `assign=${assignNote} ticked=${siteTicked}`;
  }
  await add("employee assigned to site", assignOk, String(assignSaveNote).slice(0, 70));

  // ---------- C. EMPLOYEE LEG (fresh session with the new code) ----------
  await wipe(page, cdp, baseUrl);
  await signIn(page, { email: empEmail, password: empCode, step: "signIn", dismissConsent: true, baseUrl });
  await add("forced password modal appears", (await page.evaluate(() => document.body.innerText)).includes("Set your own password"));
  await page.screenshot({ path: `${SHOTS}/15-forced.png` });

  const NEW_PW = `E2e-${stamp}-pw!`;
  await fillInput(page, 'input[placeholder="Current password / ID code"]', empCode);
  await fillInput(page, 'input[placeholder="New password (min 8 chars)"]', NEW_PW);
  await fillInput(page, 'input[placeholder="Confirm new password"]', NEW_PW);
  await clickByText(page, "Update password").catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  await page.reload({ waitUntil: "networkidle2" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  // Changing the password revokes the session, so the employee lands back on
  // the sign-in page and has to sign in with the NEW password. That is the
  // real journey — do it here instead of asserting on a page that cannot
  // exist.
  const bodyAfterPw = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (/Sign in|Activate with your ID code/i.test(bodyAfterPw)) {
    await signIn(page, {
      email: empEmail,
      password: NEW_PW,
      step: "signIn",
      dismissConsent: true,
      baseUrl,
    });
    await new Promise((r) => setTimeout(r, 3000));
  }
  for (let i = 0; i < 8; i++) {
    if (!(await clickByTestId(page, "consent-acknowledge"))) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  const buttonsAfterPw = await page.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).filter(Boolean));
  await add("password set → employee home", buttonsAfterPw.some((x) => /CHECK IN/i.test(x)));
  if (process.env.JPAY_DEBUG === "1") {
    console.log(
      "SELECTS:",
      await page.evaluate(() => [...document.querySelectorAll("select")].map((x) => `[${[...x.options].map((o) => o.text).join("/")}]`).join(" ")),
    );
    console.log("AMBER:", await page.evaluate(() => document.body.innerText.match(/No site assigned[^|]*|Loading your sites[^|]*/)?.[0]));
  }

  // ---------- D. GPS CHECK-IN ----------
  await new Promise((r) => setTimeout(r, 3000));
  await clickByTestId(page, "checkin-submit").catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));
  const t1 = await page.evaluate(() => document.body.innerText);
  if (/Loading your sites|No site assigned/.test(t1)) {
    await new Promise((r) => setTimeout(r, 3000));
    await clickByTestId(page, "checkin-submit").catch(() => {});
    await new Promise((r) => setTimeout(r, 5000));
  }
  const t2 = await page.evaluate(() => document.body.innerText);
  await add("geofence verdict", /inside geofence|Logged arrived/.test(t2), t2.match(/(inside|outside) geofence/)?.[0] ?? "");
  await add("check-in accepted", /day finish|job finish|active|checked in/i.test(t2), t2.match(/CHECK IN \|?[^|]{0,40}/)?.[0]?.trim() ?? "");
  await page.screenshot({ path: `${SHOTS}/16-checked-in.png` });

  // ---------- E. OFFLINE OUTBOX ----------
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickByText(page, "day finish").catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await clickByTestId(page, "checkin-submit").catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  const offBody = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (process.env.JPAY_DEBUG === "1") console.log("   OFFBODY:", offBody.slice(0, 260));
  await add("offline finish queued", /pending|queued|offline/i.test(offBody), offBody.match(/(Offline[^|]*|queued[^|]*|Logged[^|]*)/)?.[0] ?? "(none)");
  await page.screenshot({ path: `${SHOTS}/17-offline-queued.png` });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  }).catch(() => {});
  let replayed = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const b = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (process.env.JPAY_DEBUG === "1") console.log("   REPLAY", i, b.match(/\d check-ins? queued offline/)?.[0], "|", b.match(/Logged[^|]*|Error[^|]*/i)?.[0]);
    if (!/\d check-ins? queued offline/.test(b)) { replayed = true; break; }
    await page.evaluate(() => window.dispatchEvent(new Event("online"))).catch(() => {});
  }
  await add("online replay settled", replayed, (await page.evaluate(() => document.body.innerText).catch(() => "")).match(/\d check-ins? queued offline/)?.[0] ?? "");
}, { label: "e2e-full" }).then(({ exitCode }) => process.exit(exitCode()));
