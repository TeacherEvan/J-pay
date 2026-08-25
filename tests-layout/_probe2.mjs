import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("=== visit / ===");
const r1 = await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
console.log("status:", r1.status());
await sleep(3500);
console.log("body:", (await page.evaluate(() => document.body.innerText)).slice(0, 200));
console.log("localStorage keys:", await page.evaluate(() => Object.keys(localStorage)));
console.log("cookies:", await page.cookies());

console.log("\n=== second visit / ===");
const r2 = await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
console.log("status:", r2.status());
await sleep(3500);
console.log("body:", (await page.evaluate(() => document.body.innerText)).slice(0, 200));

await browser.close();
