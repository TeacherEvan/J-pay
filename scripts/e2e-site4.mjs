import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
async function fill(ph, v) {
  await p.click(`input[placeholder="${ph}"]`);
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 8 });
}
await fill("Name", "JNB Site B");
await fill("Latitude", "-26.1367");
console.log("lat dom:", await p.evaluate(() => document.querySelector('input[placeholder="Latitude"]')?.value));
await fill("Longitude", "28.2411");
console.log("dom vals:", await p.evaluate(() => JSON.stringify({
  n: document.querySelector('input[placeholder="Name"]')?.value,
  la: document.querySelector('input[placeholder="Latitude"]')?.value,
  lo: document.querySelector('input[placeholder="Longitude"]')?.value,
  footer: [...document.querySelectorAll("span")].find(s => s.textContent.includes(",") && s.textContent.includes("."))?.textContent
})));
await b.disconnect(); process.exit(0);
