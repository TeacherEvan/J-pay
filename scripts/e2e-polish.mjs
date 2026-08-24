import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const p = await b.newPage();
p.setDefaultTimeout(25000);
const log = (...a) => console.log(...a);

await p.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 3000));
await p.type('input[name=email]', 'ewaldt@jpay.local');
await p.type('input[name=password]', 'JP-PAEKVTJ2ZA');
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Sign in")?.click());
await new Promise(r => setTimeout(r, 6000));

let forced = await p.evaluate(() => document.body.innerText.includes("Set your own password"));
log("STEP A forced modal shown:", forced);
if (forced) {
  await p.screenshot({ path: "user-review/05-forced-modal.png" });
  const setPw = (ph, v) => p.evaluate((ph, v) => {
    const el = [...document.querySelectorAll("input")].find(i => i.placeholder === ph);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, ph, v);
  await setPw("Current password / ID code", "JP-PAEKVTJ2ZA");
  await setPw("New password (min 8 chars)", "EwaldtSecure2026!");
  await setPw("Confirm new password", "EwaldtSecure2026!");
  await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Update password")?.click());
  await new Promise(r => setTimeout(r, 7000));
}
await p.goto("http://localhost:3000/moderator", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 4000));
const stillForced = await p.evaluate(() => document.body.innerText.includes("Set your own password"));
const consoleVisible = await p.evaluate(() => document.body.innerText.includes("Moderator console"));
log("STEP B modal gone:", !stillForced, "| console visible:", consoleVisible);

// create site with typed coords + verify map iframe/canvas present
const hasMap = await p.evaluate(() => !!document.querySelector(".leaflet-container"));
log("STEP C leaflet map mounted:", hasMap);
await p.evaluate(() => {
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  const byPh = ph => [...document.querySelectorAll("input")].find(i => i.placeholder === ph);
  if (byPh("Name")) set(byPh("Name"), "JNB Test Site");
  if (byPh("Latitude")) set(byPh("Latitude"), "-26.1367");
  if (byPh("Longitude")) set(byPh("Longitude"), "28.2411");
});
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: "user-review/06-site-picker.png" });
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Create site")?.click());
await new Promise(r => setTimeout(r, 5000));
const siteMsg = await p.evaluate(() => [...document.querySelectorAll("p")].map(x => x.textContent).filter(t => /Created|error|INVALID/i.test(t)).slice(0, 2));
log("STEP D create site result:", JSON.stringify(siteMsg));
await p.screenshot({ path: "user-review/07-site-created.png" });
await b.disconnect(); process.exit(0);
