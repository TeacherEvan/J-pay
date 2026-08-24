import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
p.on("pageerror", e => console.log("PAGEERROR>>>", String(e).slice(0, 300)));
async function fill(ph, v) {
  await p.waitForSelector(`input[placeholder="${ph}"]`);
  await p.click(`input[placeholder="${ph}"]`);
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 8 });
}
await fill("Name", "JNB Test Site");
await fill("Latitude", "-26.1367");
await fill("Longitude", "28.2411");
const clicked = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Create site");
  btn?.click(); return { found: !!btn, disabled: btn?.disabled };
});
console.log("CLICK:", JSON.stringify(clicked));
await new Promise(r => setTimeout(r, 6000));
console.log("MSG:", await p.evaluate(() => [...document.querySelectorAll("p")].map(x => x.textContent).filter(t => t && (t.includes("Created") || /INVALID|error/i.test(t)))));
console.log("SITES ROW:", await p.evaluate(() => document.body.innerText.includes("JNB Test Site")));
await p.screenshot({ path: "user-review/07-site-created.png" });
await b.disconnect(); process.exit(0);
