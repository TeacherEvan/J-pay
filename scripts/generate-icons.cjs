const sharp = require("sharp");
const fs = require("fs");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <rect x="24" y="24" width="464" height="464" rx="80" fill="none" stroke="#10b981" stroke-width="12"/>
  <text x="256" y="316" font-family="Arial, Helvetica, sans-serif" font-size="200" font-weight="800"
        fill="#10b981" text-anchor="middle">JP</text>
</svg>`;

(async () => {
  fs.writeFileSync("public/icon.svg", svg);
  for (const size of [192, 512]) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icon-${size}.png`);
  }
  await sharp(Buffer.from(svg)).resize(180, 180).png().toFile("public/apple-touch-icon.png");
  console.log("icons generated");
})();
