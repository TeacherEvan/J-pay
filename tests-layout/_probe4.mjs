import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await page.createCDPSession();
await cdp.send("Emulation.setGeolocationOverride", { latitude: -26.2041, longitude: 28.0473, accuracy: 18 });

// Step through the full flow
console.log("=== / ===");
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 20; i++) {
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  if (/Sign in/.test(t)) { console.log(`  ready in ${i*0.8}s`); break; }
}

console.log("=== click demo ===");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Enter demo preview (no account)");
  btn?.click();
});
for (let i = 0; i < 30; i++) {
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  if (/CHECK IN/.test(t) && /EMPLOYEE/.test(t)) { console.log(`  panel ready in ${i*0.8}s`); break; }
}

console.log("=== offline ===");
await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "day finish");
  btn?.click();
});
await sleep(500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "CHECK IN");
  btn?.click();
});
for (let i = 0; i < 15; i++) {
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  if (/queued|pending|offline/i.test(t)) { console.log(`  queued after ${i*0.8}s: ${t.match(/Offline[^|]*|queued[^|]*|Connection[^|]*/)?.[0]}`); break; }
}

console.log("=== online + dispatch ===");
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
for (let j = 0; j < 5; j++) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  const q = t.match(/\d+ check-ins? queued offline/)?.[0];
  console.log(`  after dispatch ${j}: ${q || 'NO QUEUE COUNTER'}`);
}

console.log("=== sign out ===");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign out");
  btn?.click();
});
for (let i = 0; i < 30; i++) {
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  if (/Sign in/.test(t) && /First time\? Activate/.test(t)) { console.log(`  sign-in back in ${i*0.8}s`); break; }
  if (i % 5 === 0) console.log(`  t+${i*0.8}s: ${t.slice(0,80)}`);
}

console.log("=== /moderator ===");
const t0 = Date.now();
const r = await page.goto("http://localhost:3000/moderator", { waitUntil: "domcontentloaded", timeout: 90000 });
console.log(`  status ${r.status()} in ${Date.now() - t0}ms`);
for (let i = 0; i < 20; i++) {
  await sleep(800);
  const t = await page.evaluate(() => document.body.innerText);
  if (!/^Loading…?\s*$/.test(t.trim())) { console.log(`  rendered in ${i*0.8}s: ${t.slice(0,80)}`); break; }
}

await browser.close();
