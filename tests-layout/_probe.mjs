import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("=== / ===");
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await sleep(3000);
console.log("body text:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));
console.log("buttons:", await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.textContent?.trim() ?? "").filter(Boolean)));
console.log("form class:", await page.$eval("form", f => f.className).catch(() => "no form"));
console.log("viewport meta:", await page.$eval('meta[name="viewport"]', m => m.content).catch(() => "no meta"));

console.log("\n=== /moderator ===");
await page.goto("http://localhost:3000/moderator", { waitUntil: "domcontentloaded" });
await sleep(3000);
console.log("body text:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));

await browser.close();
