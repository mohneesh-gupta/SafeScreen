// Gender accuracy through the real extension pipeline, using hand-labelled faces in
// test/face-labels.json (image paths are relative to test/out/fixtures/).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import vm from "node:vm";

// Load the same face-label rule the extension uses.
const sharedCtx = {};
vm.runInNewContext(await readFile(new URL("../src/shared.js", import.meta.url), "utf8") + ";this.f = ssFaceLabel;", sharedCtx);
const ssFaceLabel = sharedCtx.f;

const ext = fileURLToPath(new URL("../src", import.meta.url));
const fx = fileURLToPath(new URL("./out/fixtures/", import.meta.url));
const labels = JSON.parse(await readFile(new URL("./face-labels.json", import.meta.url)));
const images = [...new Set(labels.map((l) => l.image)), ...(process.env.EXTRA ? [process.env.EXTRA] : [])];
const page = `<!doctype html><style>img{width:240px}</style>` +
  images.map((src, i) => `<img id="i${i}" src="/${encodeURI(src)}">`).join("");
const srv = http.createServer(async (q, r) => {
  if (q.url === "/") return r.writeHead(200, { "content-type": "text/html" }).end(page);
  try { const body = await readFile(fx + decodeURI(q.url.slice(1))); r.writeHead(200).end(body); } catch { r.writeHead(404).end(); }
}).listen(8709);

const browser = await puppeteer.launch({ headless: true, enableExtensions: [ext] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 20000 }); // everything in view so all images get scanned
  await p.goto("http://127.0.0.1:8709/");
  let state;
  for (let i = 0; i < 120; i++) {
    state = await p.evaluate(() => new Promise((res) => {
      addEventListener("message", function h(e) { if (e.data?.type === "safescreen-test-result") { removeEventListener("message", h); res(e.data); } });
      postMessage({ type: "safescreen-test-state" }, "*");
    }));
    if (state.items.length === images.length && state.items.every((x) => x.ss)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const sizes = await p.$$eval("img", (els) => els.map((e) => [e.id, e.naturalWidth, e.naturalHeight]));
  const size = Object.fromEntries(sizes.map(([id, w, h]) => [id, { w, h }]));
  const byId = Object.fromEntries(state.items.map((x) => [x.id, x]));
  let correct = 0, found = 0;
  const wrong = [];
  for (const l of labels) {
    const id = `i${images.indexOf(l.image)}`, { w, h } = size[id];
    const faces = (byId[id]?.detections || []).filter((d) => d.label.startsWith("FACE_"));
    const dist = (d) => Math.hypot((d.x + d.w / 2) * w - l.cx, (d.y + d.h / 2) * h - l.cy);
    const face = faces.sort((a, b) => dist(a) - dist(b))[0];
    if (!face || dist(face) > face.w * w * 0.6) continue;
    found++;
    const got = ssFaceLabel(face, "medium") === "FACE_FEMALE" ? "F" : "M";
    if (got === l.gender) correct++;
    else wrong.push(`${l.image} expected ${l.gender} got ${got} (pFemale=${face.female?.toFixed(2)}${face.femaleBody ? ", female body" : ""})`);
  }
  console.log(`Faces matched: ${found}/${labels.length}. Gender correct: ${correct}/${found} (${Math.round((100 * correct) / found)}%)`);
  wrong.forEach((w) => console.log("  wrong:", w));
  if (process.env.DUMP) for (const [i, src] of images.entries()) if (src.includes(process.env.DUMP)) console.log(src, JSON.stringify(byId[`i${i}`].detections.map((d) => [d.label, +d.score.toFixed(2), d.female && +d.female.toFixed(2), +d.x.toFixed(2), +d.y.toFixed(2), +d.w.toFixed(2), +d.h.toFixed(2)])));
  process.exitCode = correct / found >= 0.8 ? 0 : 1;
} finally {
  await browser.close();
  srv.close();
}
