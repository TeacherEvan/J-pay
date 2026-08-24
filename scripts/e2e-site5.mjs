import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
await p.reload({ waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 3000));
async function fill(ph, v) {
  await p.click(`input[placeholder="${ph}"]`, { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 8 });
}
await fill("Name", "JNB Test Site");
await fill("Latitude", "-26.1367");
await fill("Longitude", "28.2411");
const dom = await p.evaluate(() => ({
  la: document.querySelector('input[placeholder="Latitude"]')?.value,
  lo: document.querySelector('input[placeholder="Longitude"]')?.value,
}));
console.log("DOM:", JSON.stringify(dom));
// patch fetch to capture outgoing args
await p.evaluate(() => {
  window.__args = [];
  const o = window.fetch;
  window.fetch = async (...a) => {
    try {
      if (String(a[0]).includes("/api/mutation")) window.__args.push(JSON.parse(String(a[1]?.body ?? "{}")).arguments ?? "no-arg-field");
    } catch {}
    return o(...a);
  };
});
await p.evaluate(() => [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Create site")?.click());
await new Promise(r => setTimeout(r, 6000));
console.log("ARGS:", await p.evaluate(() => JSON.stringify(window.__args).slice(0, 400)));
console.log("SITES ROW:", await p.evaluate(() => document.body.innerText.includes("JNB Test Site")));
await b.disconnect(); process.exit(0);
