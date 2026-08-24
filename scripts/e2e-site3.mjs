import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("/moderator"));
p.on("request", req => {
  if (req.url().includes("/api/mutation") && req.method() === "POST") {
    console.log("MUTATION BODY:", req.postData()?.slice(0, 400));
  }
});
async function fill(ph, v) {
  await p.click(`input[placeholder="${ph}"]`);
  await p.type(`input[placeholder="${ph}"]`, v, { delay: 8 });
}
await fill("Name", "JNB Site B");
await fill("Latitude", "-26.1367");
await fill("Longitude", "28.2411");
await p.evaluate(() => [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Create site")?.click());
await new Promise(r => setTimeout(r, 5000));
ws_noop: ;
await b.disconnect(); process.exit(0);
