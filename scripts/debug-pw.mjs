import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", defaultViewport: null });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("localhost:3000")) ?? await b.newPage();
p.on("pageerror", e => console.log("PAGEERROR:", String(e).slice(0, 300)));
  p.on("console", m => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 250)); });
  await p.goto("http://localhost:3000/moderator", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
console.log("URL:", p.url());
console.log("TEXT HEAD:", (await p.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 220));
// open change-password
const opened = await p.evaluate(() => {
  const s = [...document.querySelectorAll("summary")].find(x => x.textContent.includes("Change password"));
  if (s) { s.click(); return true; } return false;
});
console.log("opened:", opened);
if (opened) {
  await new Promise(r => setTimeout(r, 400));
  await p.evaluate(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    [...document.querySelectorAll("input")].forEach(el => {
      if (el.placeholder === "Current password / ID code") set(el, "JP-PAEKVTJ2ZA");
      if (el.placeholder === "New password (min 8 chars)") set(el, "EwaldtSecure2026!");
    });
  });
  const bodies = [];
  await p.setRequestInterception(true);
  p.on("request", req => { req.continue(); });
  p.on("response", async res => { if (res.url().includes("/api/action")) { try { bodies.push(await res.text()); } catch {} } });
  await Promise.all([
    p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Update password")?.click()),
    new Promise(r => setTimeout(r, 7000)),
  ]);
  const state = await p.evaluate(() => ({
    msgs: [...document.querySelectorAll("p")].map(x => x.textContent).filter(t => /password|error|invalid/i.test(t)).slice(0, 3),
    pwLens: [...document.querySelectorAll("input[type=password]")].map(i => i.value.length),
  }));
  console.log("RESULT:", JSON.stringify(state));
  console.log("LAST ACTION RESP:", (bodies.at(-1) ?? "(none)").slice(0, 500));
}
await b.close ? null : null;
process.exit(0);
