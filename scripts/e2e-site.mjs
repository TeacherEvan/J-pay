import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
for (const pg of pages) console.log("TAB:", pg.url());
let p = pages.find(pg => pg.url().includes("/moderator"));
if (!p) { p = pages.find(pg => pg.url().includes("localhost")); await p.goto("http://localhost:3000/moderator", { waitUntil: "networkidle2" }); }
console.log("USING:", p.url());
await new Promise(r => setTimeout(r, 2500));
async function fill(ph, v) {
  await p.waitForSelector(`input[placeholder="${ph}"]`, { timeout: 8000 });
  await p.click(`input[placeholder="${ph}"]`);
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 12 });
}
await fill("Name", "JNB Test Site");
await fill("Latitude", "-26.1367");
await fill("Longitude", "28.2411");
const bodies = [];
p.on("response", async res => { const u = res.url(); if (u.includes("/api/")) try { bodies.push({ s: res.status(), b: (await res.text()).slice(0, 220) }); } catch {} });
await p.evaluate(() => [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Create site")?.click());
await new Promise(r => setTimeout(r, 6000));
console.log("non-200/err responses:", JSON.stringify(bodies.filter(x => x.b.includes("Error") || x.s >= 400)).slice(0, 500));
console.log("created msg:", await p.evaluate(() => [...document.querySelectorAll("p")].map(x => x.textContent).filter(t => t && t.includes("Created"))));
await p.screenshot({ path: "user-review/07-site-created.png" });
await b.disconnect(); process.exit(0);
