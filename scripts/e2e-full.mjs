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
  waitForText,
  waitForUrl,
} from "./e2e-helpers.mjs";

const { MOD_EMAIL, MOD_PW } = requireEnv(["JPAY_EMAIL", "JPAY_PASSWORD"], {
  message: "Set JPAY_EMAIL + JPAY_PASSWORD (moderator credentials) before running.",
});

mkdirSync("user-review", { recursive: true });

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

  // ---------- A0. DEMO PREVIEW LEG (R36: demo optional + selectable at login) ----------
  await wipe(page, cdp, baseUrl);
  {
    const t = await waitForText(page, /Enter demo preview/, { timeoutMs: 15_000 }).catch(() => "");
    const clicked = t ? await clickByTestId(page, "demo-preview-cta") : false;
    await add("demo preview selectable at login", clicked);
    let body = "";
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      body = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
      if (/CHECK IN/.test(body)) break;
    }
    await add("demo session → employee panel", /CHECK IN/.test(body));
    await add("demo role = employee", /EMPLOYEE/i.test(body));
    await add("demo reviewer has sites", !/No site assigned/.test(body));
    await add("forced password skipped for reviewer", !/Set your own password/.test(body));
    await clickByTestId(page, "consent-acknowledge").catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    await clickByTestId(page, "checkin-submit").catch(() => {});
    let logged = false;
    let matchLine = "";
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const cur = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
      if (/Logged \w+/.test(cur)) { logged = true; matchLine = cur; break; }
      if (/Weak GPS|denied/i.test(cur)) { matchLine = cur; break; }
    }
    await add("demo check-in writes real log", logged, matchLine.match(/Logged \w+|Weak GPS[^\n]*|denied[^\n]*/)?.[0] ?? "");
    await page.screenshot({ path: "user-review/00-demo-checkin.png" });
    await clickByTestId(page, "auth-signout").catch(() => {});
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const cur = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
      if (/Sign in/.test(cur)) break;
    }
    await add("demo sign out returns to login", /Sign in/.test(await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "))));
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

  await clickByText(page, "map").catch(() => {});
  await new Promise((r) => setTimeout(r, 3500));
  const modalOk = await page.evaluate(() => !!document.querySelector("[role='dialog'] .leaflet-container"));
  await add("geofence modal renders Leaflet", modalOk);
  if (modalOk) {
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Zero-scroll console: switch to the Payroll tab (role=tab pill ≥md).
  await clickByText(page, "Payroll");
  await new Promise((r) => setTimeout(r, 1500));
  const resolveClicked = await clickByTestId(page, "review-resolve").catch(() => false);
  await add("resolve review item", resolveClicked);
  await new Promise((r) => setTimeout(r, 3500));

  await add("payroll panel present", /payroll/i.test(await page.evaluate(() => document.body.innerText)));

  // Zero-scroll console: provision lives on the Access tab.
  await clickByText(page, "Access");
  await new Promise((r) => setTimeout(r, 1500));

  // ---------- B. PROVISION EMPLOYEE VIA UI ----------
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
  await page.screenshot({ path: "user-review/14-provisioned.png" });

  // assign the new employee to the first site so check-in can pass the geofence
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
    assignOk = /sites assigned|Assigned\.|ALREADY_ASSIGNED/i.test(assignSaveNote);
  } else {
    assignSaveNote = `assign=${assignNote} ticked=${siteTicked}`;
  }
  await add("employee assigned to site", assignOk, String(assignSaveNote).slice(0, 70));

  // ---------- C. EMPLOYEE LEG (fresh session with the new code) ----------
  await wipe(page, cdp, baseUrl);
  await signIn(page, { email: empEmail, password: empCode, step: "signIn", dismissConsent: true, baseUrl });
  await add("forced password modal appears", (await page.evaluate(() => document.body.innerText)).includes("Set your own password"));
  await page.screenshot({ path: "user-review/15-forced.png" });

  const NEW_PW = `E2e-${stamp}-pw!`;
  await fillInput(page, 'input[placeholder="Current password / ID code"]', empCode);
  await fillInput(page, 'input[placeholder="New password (min 8 chars)"]', NEW_PW);
  await fillInput(page, 'input[placeholder="Confirm new password"]', NEW_PW);
  await clickByText(page, "Update password").catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  await page.reload({ waitUntil: "networkidle2" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
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
  await page.screenshot({ path: "user-review/16-checked-in.png" });

  // ---------- E. OFFLINE OUTBOX ----------
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickByText(page, "day finish").catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await clickByTestId(page, "checkin-submit").catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  const offBody = await page.evaluate(() => document.body.innerText);
  if (process.env.JPAY_DEBUG === "1") console.log("   OFFBODY:", offBody.slice(0, 260));
  await add("offline finish queued", /pending|queued|offline/i.test(offBody), offBody.match(/(Offline[^|]*|queued[^|]*|Logged[^|]*)/)?.[0] ?? "(none)");
  await page.screenshot({ path: "user-review/17-offline-queued.png" });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  let replayed = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const b = await page.evaluate(() => document.body.innerText);
    if (process.env.JPAY_DEBUG === "1") console.log("   REPLAY", i, b.match(/\d check-ins? queued offline/)?.[0], "|", b.match(/Logged[^|]*|Error[^|]*/i)?.[0]);
    if (!/\d check-ins? queued offline/.test(b)) { replayed = true; break; }
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
  await add("online replay settled", replayed, (await page.evaluate(() => document.body.innerText)).match(/\d check-ins? queued offline/)?.[0] ?? "");
}, { label: "e2e-full" }).then(({ exitCode }) => process.exit(exitCode()));
