import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
console.log(await p.evaluate(() => JSON.stringify({
  url: location.pathname,
  placeholders: [...document.querySelectorAll("input")].map(i => i.placeholder || i.type),
  nameVal: document.querySelector('input[placeholder="Name"]')?.value ?? null,
  latVal: document.querySelector('input[placeholder="Latitude"]')?.value ?? null,
})));
await p.screenshot({ path: "user-review/dbg-form.png" });
await b.disconnect(); process.exit(0);
