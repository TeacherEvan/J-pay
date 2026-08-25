import puppeteer from "puppeteer-core";

// Standalone demo-preview leg — runs against JPAY_BASE_URL (default http://localhost:3000).
// No credentials needed. Verifies the R36 feature: demo selectable at login, employee panel
// reachable, GPS check-in writes a real log, sign out returns to login.
const BASE = process.env.JPAY_BASE_URL ?? "http://localhost:3000";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 90000 });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => p.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
const clickBtn = (label) =>
  p.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(l));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
let ok = true;
const check = (cond, label, detail = "") => {
  if (!cond) ok = false;
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
};
try {
  const cdp = await p.createCDPSession();
  await cdp.send("Emulation.setGeolocationOverride", { latitude: -26.2041, longitude: 28.0473, accuracy: 15 });
  try { await cdp.send("Browser.grantPermissions", { permissions: ["geolocation"], origin: BASE }); } catch {}

  // isolation: a leftover session (from any earlier leg on this shared Chrome) must not
  // skip the login screen — start every run from a clean cookie jar and storage
  await cdp.send("Network.clearBrowserCookies");
  try { await cdp.send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" }); } catch {}

  await p.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });

  // guard: the served app must actually be J-Pay (port-collision sentinel)
  let t = await text();
  for (let i = 0; i < 10 && !/J-Pay/.test(t); i++) { await sleep(1500); t = await text(); }
  check(/J-Pay/.test(t), "served app is J-Pay (port-collision sentinel)");

  let clicked = false;
  for (let i = 0; i < 20 && !clicked; i++) { await sleep(1500); clicked = await clickBtn("Enter demo preview"); }
  check(clicked, "demo preview button visible and selectable at login");

  for (let i = 0; i < 25; i++) { await sleep(2000); t = await text(); if (/CHECK IN/.test(t)) break; }
  check(/CHECK IN/.test(t), "demo session lands on employee check-in panel");
  check(/EMPLOYEE/i.test(t), "role badge is employee");
  check(!/No site assigned/.test(t), "demo reviewer has assigned sites");
  check(!/Set your own password/.test(t), "forced password change skipped for reviewer");

  for (let i = 0; i < 4; i++) { if (!(await clickBtn("I understand"))) break; await sleep(1200); }

  // pick the real demo depot (JNB Central Depot sits exactly on the emulated position)
  // so the expected geofence verdict is "inside"; default may be an old ad-hoc test site
  const pickedDepot = await p.evaluate(() => {
    for (const sel of document.querySelectorAll("select")) {
      const opt = [...sel.options].find((o) => o.text === "JNB Central Depot");
      if (opt) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  await sleep(1200);

  let pressed = false;
  // wait for an ENABLED check-in button: the site change can trigger a refetch
  // that disables it transiently, and .click() on a disabled button is a no-op
  for (let i = 0; i < 10 && !pressed; i++) {
    pressed = await p.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("CHECK IN"));
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    });
    if (!pressed) await sleep(2000);
  }
  check(pressed, "CHECK IN button clickable");
  let logged = false;
  let verdict = "";
  // "Logged …" renders optimistically; the RECENT row carrying the geofence
  // verdict arrives one query-refetch later — poll until both are visible
  for (let i = 0; i < 12; i++) {
    await sleep(2000); t = await text();
    if (/Logged \w+/.test(t)) logged = true;
    if (logged && /geofence/.test(t)) { verdict = t.match(/.{0,40}?geofence/)?.[0] ?? ""; break; }
    if (/Weak GPS|denied/i.test(t)) break;
  }
  if (!logged) console.log("   check-in diag body:", t.slice(0, 300));
  else if (!verdict) console.log("   verdict diag body:", t.slice(0, 400));
  check(logged, "check-in writes a real log", logged ? "logged" : (t.match(/Weak GPS[^\n]*|denied[^\n]*/)?.[0] ?? "(no result)"));
  // page.tsx renders " · outside geofence" ONLY when isWithinGeofence=false;
  // an inside check-in shows no flag at all — so absence of the flag = inside
  if (pickedDepot) check(logged && !/\boutside geofence\b/i.test(t), "check-in accepted inside geofence (no outside flag)", /\boutside geofence\b/i.test(t) ? "flagged outside" : "clean");
  else console.log(`ℹ depot site not offered — verdict check skipped (${verdict})`);

  let out = false;
  for (let i = 0; i < 2 && !out; i++) {
    await clickBtn("Sign out");
    for (let j = 0; j < 8; j++) { await sleep(1500); t = await text(); if (/Sign in/.test(t)) { out = true; break; } }
  }
  if (!out) {
    console.log("   sign-out diag buttons:", await p.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).filter(Boolean).join(" / ")).catch(() => "?"));
    console.log("   sign-out diag body:", t.slice(0, 200));
  }
  check(out, "sign out returns to login");
  await p.screenshot({ path: "user-review/e2e-demo-leg.png" });
} finally {
  if (errors.length) { ok = false; console.log("PAGE ERRORS:", errors.join(" || ")); }
  await p.close().catch(() => {});
  await b.disconnect();
}
console.log(ok ? "DEMO LEG: ALL PASS" : "DEMO LEG: FAILURES");
process.exit(ok ? 0 : 1);
