import puppeteer from "puppeteer-core";

const url = process.argv[2] || "https://j-pay.vercel.app";
const out = process.argv[3] || "/tmp/jpay-live";
const exe = process.env.CHROME_PATH;

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const result = { url, finalUrl: null, title: null, text: "", errors: [], failed: [], shots: [] };

// Mobile viewport first (the employee surface).
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") result.errors.push(m.text().slice(0, 240));
});
page.on("requestfailed", (r) => result.failed.push(`${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ""}`.trim()));
page.on("response", (r) => {
  const s = r.status();
  if (s >= 400) result.failed.push(`${s} ${r.url().slice(0, 140)}`);
});

await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

result.finalUrl = page.url();
result.title = await page.title();
result.text = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
await page.screenshot({ path: `${out}-mobile.png`, fullPage: true });
result.shots.push(`${out}-mobile.png`);

// Desktop viewport (moderator console / dashboard).
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${out}-desktop.png`, fullPage: true });
result.shots.push(`${out}-desktop.png`);

// Does the runtime actually reach the Convex deployment? Convex uses a
// WebSocket, which never appears in resource timing — listen to every request.
const convexSeen = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("convex.cloud") && convexSeen.length < 5) convexSeen.push(`${r.method()} ${u.slice(0, 160)}`);
});
// Force a round trip: a bogus sign-in must fail with a BACKEND message.
// A network failure here would mean the frontend cannot reach Convex at all.
result.signInProbe = await (async () => {
  try {
    await page.type('input[name="email"]', "verification@example.invalid", { delay: 10 });
    await page.type('input[name="password"]', "not-a-real-code", { delay: 10 });
    await page.click('[data-testid="auth-submit-signIn"]');
    await new Promise((r) => setTimeout(r, 6000));
    return await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => p.className.includes("red-400"));
      return el ? el.textContent : "(no error surfaced)";
    });
  } catch (e) {
    return `probe failed: ${e.message}`;
  }
})();
await new Promise((r) => setTimeout(r, 800));
result.convexRequests = convexSeen;

await browser.close();
console.log(JSON.stringify(result, null, 2));
