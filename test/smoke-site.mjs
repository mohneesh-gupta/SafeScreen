// Manual smoke test on a real website: node test/smoke-site.mjs [url]
// Saves a screenshot to test/out/site.png and prints scan stats.
import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";

const url = process.argv[2] || "https://www.youtube.com/results?search_query=actress+interview";
const ext = fileURLToPath(new URL("../src", import.meta.url));
const browser = await puppeteer.launch({ headless: true, enableExtensions: [ext] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => /content\.js/.test(e.stack || "") && errors.push(e.stack));
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));
  const s = await page.evaluate(() => new Promise((res) => {
    addEventListener("message", function h(e) { if (e.data?.type === "safescreen-test-result") { removeEventListener("message", h); res(e.data); } });
    postMessage({ type: "safescreen-test-state" }, "*");
  }));
  const count = (v) => s.items.filter((i) => i.ss === v).length;
  console.log(`media tracked=${s.items.length} done=${count("done")} skipped=${count("skip")} failed=${count("full")} pending=${count(null)} masks=${s.masks}`);
  const errs = [...new Set(s.items.filter((i) => i.error).map((i) => i.error))];
  if (errs.length) console.log("scan errors:", errs.slice(0, 5));
  console.log("content-script errors:", errors.length ? errors : "none");
  await page.screenshot({ path: fileURLToPath(new URL("./out/site.png", import.meta.url)) });
} finally {
  await browser.close();
}
