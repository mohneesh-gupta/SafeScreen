// End-to-end test: loads the unpacked extension in Chrome for Testing and checks real detections.
// Fixtures live in test/out/fixtures (woman.jpg, man.jpg, swimsuit.jpg, landscape.jpg).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ext = fileURLToPath(new URL("../src", import.meta.url));
const fixtures = fileURLToPath(new URL("./out/fixtures/", import.meta.url));
const out = fileURLToPath(new URL("./out/", import.meta.url));
const A = 8701, B = 8702; // B is a second origin without CORS headers

const PAGE = `<!doctype html><meta charset="utf-8"><title>SafeScreen test</title>
<style>body{font:14px sans-serif;margin:16px} img,video,canvas{width:300px;margin:4px;vertical-align:top}
#cover{width:200px;height:300px;object-fit:cover}</style>
<img id="woman" src="/f/woman.jpg"><img id="man" src="/f/man.jpg"><img id="landscape" src="/f/landscape.jpg">
<img id="swimXO" src="http://127.0.0.1:${B}/f/swimsuit.jpg"><img id="cover" src="/f/woman.jpg?cover">
<video id="video" muted autoplay playsinline></video><div id="later"></div>
<script>
  // Live video: a canvas stream showing the woman photo.
  const c = document.createElement("canvas"); c.width = 640; c.height = 640;
  const img = new Image(); img.src = "/f/woman.jpg?video";
  img.onload = () => { const g = c.getContext("2d"); setInterval(() => g.drawImage(img, 0, 0, 640, 640), 50);
    const v = document.getElementById("video"); v.srcObject = c.captureStream(20); v.play(); };
  // Dynamically inserted image, like infinite scroll.
  setTimeout(() => { window.insertedAt = performance.now();
    const i = document.createElement("img"); i.id = "dynamic"; i.src = "/f/swimsuit.jpg?dyn";
    document.getElementById("later").append(i); }, 3000);
  window.ssState = () => new Promise((res) => {
    addEventListener("message", function h(e) { if (e.data?.type === "safescreen-test-result") { removeEventListener("message", h); res(e.data); } });
    postMessage({ type: "safescreen-test-state" }, "*");
  });
</script>`;

function serve(port, withPage) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const path = req.url.split("?")[0];
      if (withPage && path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      try {
        const body = await readFile(fixtures + path.replace("/f/", ""));
        res.writeHead(200, { "content-type": "image/jpeg" }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const labels = (item, min = 0.35) =>
  (item?.detections || []).filter((d) => d.score >= min).map((d) => `${d.label}:${d.score.toFixed(2)}`);
const has = (item, label, min = 0.35) => (item?.detections || []).some((d) => d.label === label && d.score >= min);

const servers = [await serve(A, true), await serve(B, false)];
const browser = await puppeteer.launch({ headless: true, enableExtensions: [ext], args: ["--window-size=1400,1000"] });

try {
  const worker = await (await browser.waitForTarget((t) => t.type() === "service_worker")).worker();
  const setSettings = (patch) => worker.evaluate((p) => chrome.storage.local.set(p), patch);

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${A}/`);

  // Fail-closed: right after load, unscanned images must be blurred.
  const earlyFilter = await page.$eval("#landscape", (el) => (el.dataset.ss ? "scanned" : getComputedStyle(el).filter));
  check("unscanned image is pre-blurred", earlyFilter === "scanned" || earlyFilter.includes("blur"), earlyFilter);

  const ids = ["woman", "man", "landscape", "swimXO", "cover", "video", "dynamic"];
  let state;
  for (let i = 0; i < 100; i++) {
    state = await page.evaluate(() => window.ssState());
    const byId = Object.fromEntries(state.items.map((x) => [x.id, x]));
    if (ids.every((id) => byId[id]?.ss)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const byId = Object.fromEntries(state.items.map((x) => [x.id, x]));
  console.log(`\nAll media scanned after ${Date.now() - t0} ms (includes model load)\n`);
  for (const id of ids) console.log(`  ${id.padEnd(10)} ss=${byId[id]?.ss} ${byId[id]?.error || ""} ${labels(byId[id], 0.25).join(", ")}`);
  console.log();

  check("every image/video was scanned", ids.every((id) => byId[id]?.ss === "done"), ids.map((id) => `${id}=${byId[id]?.ss}`).join(" "));
  check("female face detected", has(byId.woman, "FACE_FEMALE"), labels(byId.woman).join(", "));
  const pf = (item) => (item?.detections || []).filter((d) => d.female != null).map((d) => d.female.toFixed(2)).join(", ");
  check("male face is not labelled female", has(byId.man, "FACE_MALE", 0.25) && !has(byId.man, "FACE_FEMALE", 0.25), `pFemale ${pf(byId.man)}`);
  check("female face confirmed by gender model", (byId.woman?.detections || []).some((d) => d.label === "FACE_FEMALE" && d.female > 0.5), `pFemale ${pf(byId.woman)}`);
  check("small female face found via body context", (byId.swimXO?.detections || []).some((d) => d.femaleBody), labels(byId.swimXO, 0.25).join(", "));
  check("male photo gets no masks with default targets", byId.man?.masks === 0, `${byId.man?.masks} masks`);
  check("landscape has no detections", labels(byId.landscape, 0.25).length === 0);
  check("cross-origin image scanned via extension fetch", has(byId.swimXO, "FEMALE_BREAST_COVERED"), labels(byId.swimXO).join(", "));
  check("object-fit:cover image scanned", has(byId.cover, "FACE_FEMALE"));
  check("live video frames detected", has(byId.video, "FACE_FEMALE"), labels(byId.video).join(", "));
  check("dynamically inserted image scanned", has(byId.dynamic, "FEMALE_BREAST_COVERED"));
  check("masks are drawn", state.masks > 0, `${state.masks} masks`);
  const lsFilter = await page.$eval("#landscape", (el) => getComputedStyle(el).filter);
  check("clean image is un-blurred after scan", lsFilter === "none", lsFilter);
  await page.screenshot({ path: out + "1-blur.png" });

  // Latency for a new image once the model is warm.
  const latency = await page.evaluate(async () => {
    const i = document.createElement("img");
    i.id = "timed";
    const start = performance.now();
    i.src = "/f/woman.jpg?t=" + Date.now();
    document.body.prepend(i);
    while (i.dataset.ss !== "done" && i.dataset.ss !== "full") await new Promise((r) => setTimeout(r, 5));
    return Math.round(performance.now() - start);
  });
  check("warm image scan latency < 500 ms", latency < 500, `${latency} ms (includes image load)`);

  await setSettings({ maskStyle: "image" });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: out + "2-flower.png" });

  await page.evaluate(() => document.getElementById("video").pause());
  await new Promise((r) => setTimeout(r, 600));
  const before = await page.evaluate(() => window.ssState());
  await setSettings({ targets: { femaleFace: false } });
  await new Promise((r) => setTimeout(r, 400));
  const noFace = await page.evaluate(() => window.ssState());
  check("turning a target off removes its masks", noFace.masks < before.masks, `${before.masks} -> ${noFace.masks}`);

  await setSettings({ enabled: false });
  await new Promise((r) => setTimeout(r, 400));
  const off = await page.evaluate(() => window.ssState());
  const offFilter = await page.$eval("#woman", (el) => getComputedStyle(el).filter);
  check("disabling removes all masks and blur", off.masks === 0 && offFilter === "none", `${off.masks} masks, filter=${offFilter}`);
  await setSettings({ enabled: true, maskStyle: "blur", targets: { femaleFace: true } });

  const popup = await browser.newPage();
  await popup.setViewport({ width: 300, height: 620 });
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await new Promise((r) => setTimeout(r, 300));
  await popup.screenshot({ path: out + "3-popup.png" });

  check("no page errors", errors.length === 0, errors.join("; "));
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in test/out/`);
process.exit(failed ? 1 : 0);
