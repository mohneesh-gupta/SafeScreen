// Renders the bundled flower mask image and the extension icons from inline SVG.
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../src/assets/", import.meta.url));
const petals = Array.from({ length: 8 }, (_, i) =>
  `<ellipse cx="256" cy="140" rx="62" ry="110" fill="${i % 2 ? "#f9a8d4" : "#f472b6"}" transform="rotate(${i * 45} 256 256)"/>`
).join("");
const flower = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#fdf2f8"/>${petals}
  <circle cx="256" cy="256" r="62" fill="#facc15"/><circle cx="256" cy="256" r="40" fill="#f59e0b"/></svg>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <path d="M64 8 L112 26 V62 C112 92 90 112 64 122 C38 112 16 92 16 62 V26 Z" fill="#1d4ed8"/>
  <circle cx="64" cy="64" r="26" fill="#93c5fd"/><circle cx="64" cy="64" r="12" fill="#1e3a8a"/></svg>`;

const browser = await puppeteer.launch();
const page = await browser.newPage();
async function shot(svg, size, file) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: out + file, omitBackground: true });
}
await shot(flower, 512, "flower.png");
for (const s of [16, 32, 48, 128]) await shot(icon, s, `icon${s}.png`);
await browser.close();
console.log("Assets written to", out);
