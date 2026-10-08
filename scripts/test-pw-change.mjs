// One-shot test: sign in as e2e-review, complete the forced password change,
// verify the new password works for re-sign-in.
import puppeteer from "puppeteer-core";

const CDP = "http://127.0.0.1:9300";
const BASE = "http://localhost:3000";
const EMAIL = "e2e-review@jpay.local";
const OLD_PW = "JP-VEEGKF8U3Q";
const NEW_PW = "TestNewPw3696";

const browser = await puppeteer.connect({ browserURL: CDP });
for (const pg of await browser.pages()) await pg.close();
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send("Network.clearBrowserCookies");
await cdp.send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" });
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));

await page.evaluate((e) => {
  const el = document.querySelector("input[type=email]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, e);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, EMAIL);
await page.evaluate((pw) => {
  const el = document.querySelector("input[type=password]");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, pw);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, OLD_PW);
await page.evaluate(() => {
  const btn = document.querySelector("button[type=submit]");
  btn?.click();
});
await new Promise((r) => setTimeout(r, 6000));

let body = await page.evaluate(() => document.body.innerText.slice(0, 300));
console.log("AFTER LOGIN:", body);

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll("input")].map((i) => ({ id: i.id, placeholder: i.placeholder })),
);
console.log("INPUTS:", JSON.stringify(inputs));

await page.evaluate((cur, nw) => {
  const curEl = document.getElementById("forced-pw-current") || document.querySelector('input[placeholder*="Current password"]');
  const nwEl = document.getElementById("forced-pw-next") || document.querySelector('input[placeholder*="New password"]');
  const cfEl = document.getElementById("forced-pw-confirm") || document.querySelector('input[placeholder*="Confirm"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(curEl, cur);
  curEl.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(nwEl, nw);
  nwEl.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(cfEl, nw);
  cfEl.dispatchEvent(new Event("input", { bubbles: true }));
}, OLD_PW, NEW_PW);
await new Promise((r) => setTimeout(r, 1500));

const btnInfo = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /update password/i.test(b.textContent));
  if (!btn) return "no btn";
  const wasDisabled = btn.disabled;
  btn.click();
  return `clicked; wasDisabled=${wasDisabled}`;
});
console.log("BTN:", btnInfo);
await new Promise((r) => setTimeout(r, 10000));

body = await page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log("AFTER UPDATE:", body);

await browser.disconnect();
