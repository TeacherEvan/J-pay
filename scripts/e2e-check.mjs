import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9300", defaultViewport: null, protocolTimeout: 60000 });
const pages = await b.pages();
const p = pages.find(pg => pg.url().includes("localhost:3000")) ?? await b.newPage();
await p.goto("http://localhost:3000/moderator", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 3000));
console.log((await p.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 600));
await b.disconnect(); process.exit(0);
