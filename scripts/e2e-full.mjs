import puppeteer from "puppeteer-core";

// Canonical end-to-end walkthrough (black-box, UI-only).
// Env: JPAY_EMAIL / JPAY_PASSWORD (moderator creds), JPAY_DEBUG=1, JPAY_BASE_URL (default http://localhost:3000).
// Chrome CDP on :9300.
// NOTE: if another Next.js app occupies :3000, J-pay auto-increments (:3001, …). The
// port-collision sentinel below aborts rather than driving the wrong app.
const BASE = process.env.JPAY_BASE_URL ?? "http://localhost:3000";
const MOD_EMAIL = process.env.JPAY_EMAIL;
// (JPAY_EMAIL required too — see guard below)
const MOD_PW = process.env.JPAY_PASSWORD;
if (!MOD_EMAIL || !MOD_PW) {
  console.error("Set JPAY_EMAIL + JPAY_PASSWORD (moderator credentials) before running.");
  process.exit(2);
}
const DUMP = process.env.JPAY_DEBUG === "1";
const results = [];
const errors = [];
let p;

const log = async (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "✓" : "✗"} ${step}${detail ? " — " + detail : ""}`);
  if (DUMP) try { console.log("    ", (await text()).slice(0, 170)); } catch {}
};

const b = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9300",
  defaultViewport: null,
  protocolTimeout: 90000,
});
for (const pg of await b.pages()) await pg.close().catch(() => {});
p = await b.newPage();
p.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 140)}`));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`);
});
p.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/mutation")) {
    try {
      const body = JSON.parse(r.postData() ?? "{}");
      if (String(body.path ?? "").includes("assign"))
        console.log("WIRE assign:", body.path, JSON.stringify(body.args).slice(0, 120));
    } catch {}
  }
});
const cdp = await p.createCDPSession();
await cdp.send("Emulation.setGeolocationOverride", {
  latitude: -26.2041,
  longitude: 28.0473,
  accuracy: 20,
});
try {
  await cdp.send("Browser.grantPermissions", {
    permissions: ["geolocation"],
    origin: BASE,
  });
} catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => p.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
const buttons = () => p.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).filter(Boolean));
const clickBtn = (label) =>
  p.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(l));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
const fillInput = async (selector, value) => {
  await p.waitForSelector(selector, { timeout: 10000 });
  await p.click(selector, { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type(selector, value, { delay: 6 });
};
async function wipe() {
  await cdp.send("Network.clearBrowserCookies");
  try {
    await cdp.send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" });
  } catch {}
}
async function signIn(email, pw) {
  await p.goto(BASE + "/", { waitUntil: "networkidle2" });
  await sleep(3000);
  const haveForm = await p.$('input[name=email], input[type=email], input[placeholder*="mail" i]');
  if (!haveForm) {
    await p.reload({ waitUntil: "networkidle2" }).catch(() => {});
    await sleep(4000);
  }
  await fillInput('input[name=email], input[type=email]', email).catch(
    async () => await fillInput('input[placeholder*="mail" i]', email)
  );
  await fillInput('input[type=password]', pw);
  await clickBtn("Sign in");
  await sleep(6000);
  for (let i = 0; i < 8; i++) {
    if (!(await clickBtn("I understand"))) break;
    await sleep(1200);
  }
}

// ---------- 0. PORT-COLLISION SENTINEL ----------
await p.goto(BASE + "/", { waitUntil: "networkidle2" });
let sentinel = "";
for (let i = 0; i < 15; i++) {
  sentinel = await text();
  if (/J-Pay/.test(sentinel)) break;
  await sleep(1500);
}
if (!/J-Pay/.test(sentinel)) {
  console.error(`ABORT: ${BASE} is not serving J-Pay (got: "${sentinel.slice(0, 120)}").`);
  console.error("Another app likely holds this port and J-pay auto-incremented (try JPAY_BASE_URL=http://localhost:3001).");
  await b.disconnect();
  process.exit(3);
}
await log("port-collision sentinel: J-Pay served", true, BASE);

// ---------- A0. DEMO PREVIEW LEG (R36: demo optional + selectable at login) ----------
await wipe();
{
  let t = await text();
  let clicked = false;
  for (let i = 0; i < 20 && !clicked; i++) {
    if (/Enter demo preview/.test(t)) clicked = await clickBtn("Enter demo preview");
    else { await sleep(1500); t = await text(); }
  }
  await log("demo preview selectable at login", clicked);
  for (let i = 0; i < 25; i++) { await sleep(2000); t = await text(); if (/CHECK IN/.test(t)) break; }
  await log("demo session → employee panel", /CHECK IN/.test(t));
  await log("demo role = employee", /EMPLOYEE/i.test(t));
  await log("demo reviewer has sites", !/No site assigned/.test(t));
  await log("forced password skipped for reviewer", !/Set your own password/.test(t));
  await clickBtn("I understand");
  await sleep(800);
  await clickBtn("CHECK IN");
  let logged = false;
  for (let i = 0; i < 12; i++) {
    await sleep(2000); t = await text();
    if (/Logged \w+/.test(t)) { logged = true; break; }
    if (/Weak GPS|denied/i.test(t)) break;
  }
  await log("demo check-in writes real log", logged, t.match(/Logged \w+|Weak GPS[^\n]*|denied[^\n]*/)?.[0] ?? "");
  await p.screenshot({ path: "user-review/00-demo-checkin.png" });
  await clickBtn("Sign out");
  for (let i = 0; i < 10; i++) { await sleep(1500); t = await text(); if (/Sign in/.test(t)) break; }
  await log("demo sign out returns to login", /Sign in/.test(t));
}

// ---------- A. MODERATOR LEG ----------
await wipe();
await signIn(MOD_EMAIL, MOD_PW);
await log("moderator sign-in + consent", (await text()).includes("MODERATOR"));

await p.goto(BASE + "/moderator", { waitUntil: "networkidle2" });
await sleep(5000);
await log("console loads", (await text()).includes("Moderator console"));

const kpiVals = await p.evaluate(() =>
  [...document.querySelectorAll("[aria-label='Key metrics'] .text-2xl")].map((x) => x.textContent)
);
await log("KPI cards render", kpiVals.length === 4, JSON.stringify(kpiVals));

await clickBtn("map");
await sleep(3500);
const modalOk = await p.evaluate(() => !!document.querySelector("[role='dialog'] .leaflet-container"));
await log("geofence modal renders Leaflet", modalOk);
if (modalOk) { await p.keyboard.press("Escape"); await sleep(500); }

await log("resolve review item", await clickBtn("Resolve"));
await sleep(3500);

await log("payroll panel present", /payroll/i.test(await text()));

// ---------- B. PROVISION EMPLOYEE VIA UI ----------
const stamp = Date.now().toString(36);
const empEmail = `e2e.${stamp}@jpay.local`;
const empName = `E2E Runner ${stamp}`;
await fillInput('input[placeholder="Full name"]', empName);
await fillInput('input[placeholder="Email"]', empEmail);
await clickBtn("Create account + ID code");
await sleep(5000);
const codeMatch = (await text()).match(/ID code:\s*\|?\s*(JP-[A-Z0-9]{10})/);
const empCode = codeMatch?.[1] ?? "";
await log("provision employee returns ID code", !!empCode, empCode.replace(/.(?=.{4})/g, "*"));
await p.screenshot({ path: "user-review/14-provisioned.png" });

// assign the new employee to the first site so check-in can pass the geofence
await p.waitForFunction(
  (n) => [...document.querySelectorAll("option")].filter((o) => o.text === n).length >= 2,
  { timeout: 12000 },
  empName
).catch(() => {});
const tagged = await p.evaluate((empName) => {
  const sec = [...document.querySelectorAll("section")].find((x) =>
    x.querySelector("h2")?.textContent.includes("Assign employee")
  );
  if (!sec) return null;
  const [empSel, siteSel] = [...sec.querySelectorAll("select")];
  empSel.setAttribute("data-t", "emp");
  siteSel.setAttribute("data-t", "site");
  return {
    emp: [...empSel.options].find((o) => o.text === empName)?.value,
    site: [...siteSel.options].find((o) => o.text === "JNB Central Depot")?.value,
  };
}, empName);
let assignOk = false;
let assignNote = "no-selects";
if (tagged?.emp && tagged?.site) {
  await p.select('select[data-t="emp"]', tagged.emp);
  await p.select('select[data-t="site"]', tagged.site);
  await sleep(500);
  if (DUMP) console.log("   selects:", await p.evaluate(() => {
    const e = document.querySelector('select[data-t="emp"]');
    const s2 = document.querySelector('select[data-t="site"]');
    return JSON.stringify({ emp: e?.selectedOptions[0]?.text, site: s2?.selectedOptions[0]?.text });
  }));
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Assign");
    if (btn && !btn.disabled) btn.click();
  });
  await sleep(4000);
  assignNote = await p.evaluate(() =>
    [...document.querySelectorAll("p,span")].map((x) => x.textContent).find((t) => t && (/Assigned|ASSIGNED|error|INVALID/i.test(t))) ?? "(no msg)"
  );
  assignOk = /Assigned\.|ALREADY_ASSIGNED/i.test(assignNote);
} else {
  assignNote = `tagged=${JSON.stringify(tagged)}`;
}
await log("employee assigned to site", assignOk, String(assignNote).slice(0, 70));

// ---------- C. EMPLOYEE LEG (fresh session with the new code) ----------
await wipe();
await signIn(empEmail, empCode);
await log("forced password modal appears", (await text()).includes("Set your own password"));
await p.screenshot({ path: "user-review/15-forced.png" });

const NEW_PW = `E2e-${stamp}-pw!`;
await fillInput('input[placeholder="Current password / ID code"]', empCode);
await fillInput('input[placeholder="New password (min 8 chars)"]', NEW_PW);
await fillInput('input[placeholder="Confirm new password"]', NEW_PW);
await clickBtn("Update password");
await sleep(8000);
await p.reload({ waitUntil: "networkidle2" }).catch(() => {});
await sleep(4000);
for (let i = 0; i < 8; i++) {
  if (!(await clickBtn("I understand"))) break;
  await sleep(1200);
}
await log("password set → employee home", (await buttons()).some((x) => /CHECK IN/i.test(x)));
if (DUMP) {
  console.log("SELECTS:", await p.evaluate(() => [...document.querySelectorAll("select")].map(x => `[${[...x.options].map(o=>o.text).join("/")}]`).join(" ")));
  console.log("AMBER:", await p.evaluate(() => document.body.innerText.match(/No site assigned[^|]*|Loading your sites[^|]*/)?.[0]));
}

// ---------- D. GPS CHECK-IN ----------
await sleep(3000); // let sites.listMine land
await clickBtn("CHECK IN");
await sleep(5000);
if (/Loading your sites|No site assigned/.test(await text())) {
  await sleep(3000);
  await clickBtn("CHECK IN");
  await sleep(5000);
}
await log("geofence verdict", /inside geofence|Logged arrived/.test(await text()), (await text()).match(/(inside|outside) geofence/)?.[0] ?? "");
const afterIn = await text();
await log(
  "check-in accepted",
  /day finish|job finish|active|checked in/i.test(afterIn),
  afterIn.match(/CHECK IN \|?[^|]{0,40}/)?.[0]?.trim() ?? ""
);
await p.screenshot({ path: "user-review/16-checked-in.png" });

// ---------- E. OFFLINE OUTBOX ----------
await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await clickBtn("day finish");   // select status
await sleep(600);
await clickBtn("CHECK IN");     // submit while offline
await sleep(3000);
const offBody = await text();
if (DUMP) console.log("   OFFBODY:", offBody.slice(0, 260));
await log("offline finish queued", /pending|queued|offline/i.test(offBody), offBody.match(/(Offline[^|]*|queued[^|]*|Logged[^|]*)/)?.[0] ?? "(none)");
await p.screenshot({ path: "user-review/17-offline-queued.png" });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
// CDP emulation doesn't dispatch window events — fire the same signals real browsers do
await p.evaluate(() => {
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
});
let replayed = false;
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  const b = await text();
  if (DUMP) console.log("   REPLAY", i, b.match(/\d check-ins? queued offline/)?.[0], "|", b.match(/Logged[^|]*|Error[^|]*/i)?.[0]);
  if (!/\d check-ins? queued offline/.test(b)) { replayed = true; break; }
  await p.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
}
await log("online replay settled", replayed, (await text()).match(/\d check-ins? queued offline/)?.[0] ?? "");

console.log("\nERRORS:", errors.length ? "\n" + [...new Set(errors)].slice(0, 6).join("\n") : "none");
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed`);
await b.disconnect();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
