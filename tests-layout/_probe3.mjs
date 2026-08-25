import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pre-warm
console.log("warming / ...");
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const t = await page.evaluate(() => document.body.innerText);
  if (/Sign in/.test(t) || /CHECK IN/.test(t) || /Loading/.test(t)) {
    console.log(`  t+${i}s:`, t.slice(0, 80));
    if (/Sign in/.test(t) || /CHECK IN/.test(t)) break;
  }
}

console.log("warming /moderator ...");
await page.goto("http://localhost:3000/moderator", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  const t = await page.evaluate(() => document.body.innerText);
  console.log(`  t+${i}s:`, t.slice(0, 80));
  if (!/Loading/.test(t)) break;
}

console.log("\n=== second / ===");
const r = await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("status:", r.status());
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const t = await page.evaluate(() => document.body.innerText);
  console.log(`  t+${i}s:`, t.slice(0, 80));
  if (!/Loading/.test(t)) break;
}

await browser.close();
