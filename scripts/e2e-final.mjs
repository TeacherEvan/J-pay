import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 90000 });
const pages = await b.pages();
let p = pages.find(pg => pg.url().includes("/moderator")) ?? pages.find(pg => pg.url().includes("localhost"));
await p.goto("http://localhost:3000/moderator", { waitUntil: "networkidle2", timeout: 45000 });
await new Promise(r => setTimeout(r, 4000));
const kpi = await p.evaluate(() =>
  [...document.querySelectorAll("[aria-label='Key metrics'] .text-2xl")].map(x => x.textContent)
);
console.log("KPI:", JSON.stringify(kpi));
// seed demo
const seedBtn = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(x => x.textContent.includes("Seed investor demo"));
  if (btn) { btn.click(); return true; } return false;
});
console.log("seed clicked:", seedBtn);
await new Promise(r => setTimeout(r, 25000));
const msg = await p.evaluate(() => [...document.querySelectorAll("span")].map(x => x.textContent).find(t => t && t.includes("Seeded")));
console.log("seed result:", msg ?? "(pending)");
// geofence modal
const mapBtn = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "map");
  if (btn) { btn.click(); return true; } return false;
});
await new Promise(r => setTimeout(r, 4000));
const modal = await p.evaluate(() => ({
  open: !!document.querySelector("[role='dialog']"),
  leaflet: !!document.querySelector(".leaflet-container"),
  verdict: [...document.querySelectorAll("dd")].map(d => d.textContent).find(t => t?.includes("geofence")),
}));
console.log("modal:", JSON.stringify(modal));
await p.screenshot({ path: "user-review/08-kpi-geofence.png" });
if (modal.open) await p.keyboard.press("Escape").catch(()=>{});
await b.disconnect(); process.exit(0);
