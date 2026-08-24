import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
p.on("pageerror", e => console.log("PAGEERROR>>>", String(e).slice(0, 400)));
await p.reload({ waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 3000));
async function fill(ph, v) {
  await p.click(`input[placeholder="${ph}"]`);
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 10 });
}
await fill("Name", "JNB Test Site");
console.log("after name, inputs:", await p.evaluate(() => document.querySelectorAll("input").length));
await fill("Latitude", "-26.1367");
console.log("after lat, inputs:", await p.evaluate(() => document.querySelectorAll("input").length));
await fill("Longitude", "28.2411");
console.log("after lng, inputs:", await p.evaluate(() => document.querySelectorAll("input").length));
await b.disconnect(); process.exit(0);
