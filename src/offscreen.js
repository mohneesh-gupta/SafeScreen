// Runs NudeNet 320n (YOLOv8) with onnxruntime-web. Mirrors the reference Python preprocessing:
// RGB, padded bottom/right to a square, resized to 320x320, scaled to 0..1, NCHW.
import * as ort from "./vendor/ort.wasm.bundle.min.mjs";

const SIZE = 320;
const MIN_SCORE = 0.2;
const NMS_IOU = 0.45;
const CACHE_LIMIT = 500;

// Threads need cross-origin isolation (set in manifest.json for extension pages).
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, navigator.hardwareConcurrency >> 1)) : 1;

const sessionPromise = ort.InferenceSession.create(chrome.runtime.getURL("models/320n.onnx"), {
  executionProviders: ["wasm"]
});
// NudeNet can't tell male from female faces, so every face is re-checked by a small dedicated
// gender classifier (LCNet-0.5, 112x112 face crop, ImageNet-normalised BGR; output[1] = female).
const genderPromise = ort.InferenceSession.create(chrome.runtime.getURL("models/gender_lcnet_050.onnx"), {
  executionProviders: ["wasm"]
});
const FACE = 112;
const FACE_CROP = 1.1; // crop side relative to the larger face-box side (tuned on labelled faces)
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const FEMALE_BODY = new Set(["FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_COVERED", "FEMALE_GENITALIA_EXPOSED"]);
const faceCanvas = new OffscreenCanvas(FACE, FACE);
const faceCtx = faceCanvas.getContext("2d", { willReadFrequently: true });
const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const cache = new Map(); // url -> detections (only for real URLs, not data: frames)
// ONNX sessions can't run concurrently, so jobs run one at a time. Still images go first:
// they are cached and unblock a whole picture, while a late video frame is soon replaced anyway.
const jobs = [];
let running = false;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== "offscreen" || msg.type !== "ss-detect") return;
  detectCached(msg.src, msg.video).then(
    (detections) => reply({ detections }),
    (e) => reply({ error: String(e?.message || e) })
  );
  return true;
});

async function detectCached(src, video) {
  const cacheable = !src.startsWith("data:");
  if (cacheable && cache.has(src)) return cache.get(src);
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  const detections = await new Promise((resolve, reject) => {
    jobs[video ? "push" : "unshift"]({ bitmap, resolve, reject });
    pump();
  });
  bitmap.close();
  if (cacheable) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(src, detections);
  }
  return detections;
}

async function pump() {
  if (running) return;
  running = true;
  while (jobs.length) {
    const job = jobs.shift();
    await detect(job.bitmap).then(job.resolve, job.reject);
  }
  running = false;
}

async function detect(bitmap) {
  const session = await sessionPromise;
  const w = bitmap.width, h = bitmap.height;
  const scale = SIZE / Math.max(w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, 0, 0, w * scale, h * scale);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  const area = SIZE * SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[area + i] = data[i * 4 + 1] / 255;
    input[2 * area + i] = data[i * 4 + 2] / 255;
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) };
  const out = (await session.run(feeds))[session.outputNames[0]];
  const [, channels, anchors] = out.dims; // [1, 4 + classes, anchors]
  const o = out.data;

  // Box coordinates are in model pixels; convert to 0..1 of the original image.
  const sx = 1 / (scale * w), sy = 1 / (scale * h);
  const candidates = [];
  for (let a = 0; a < anchors; a++) {
    let best = 0, cls = -1;
    for (let c = 4; c < channels; c++) {
      const s = o[c * anchors + a];
      if (s > best) { best = s; cls = c - 4; }
    }
    if (best < MIN_SCORE) continue;
    const cx = o[a], cy = o[anchors + a], bw = o[2 * anchors + a], bh = o[3 * anchors + a];
    const x = Math.max(0, (cx - bw / 2) * sx), y = Math.max(0, (cy - bh / 2) * sy);
    candidates.push({
      label: SS_LABELS[cls],
      score: best,
      x, y,
      w: Math.min(bw * sx, 1 - x),
      h: Math.min(bh * sy, 1 - y)
    });
  }
  const detections = nms(candidates);
  for (const d of detections) {
    if (d.label === "FACE_FEMALE" || d.label === "FACE_MALE") await classifyFace(bitmap, d, detections);
  }
  return detections;
}

// Sets d.female (probability from the gender model) and relabels the face. A face with a
// female chest/body region directly below it also counts as female; this catches side
// profiles that the face model gets wrong.
async function classifyFace(bitmap, d, all) {
  const session = await genderPromise;
  const W = bitmap.width, H = bitmap.height;
  const side = Math.max(d.w * W, d.h * H) * FACE_CROP;
  const cx = (d.x + d.w / 2) * W, cy = (d.y + d.h / 2) * H;
  faceCtx.fillStyle = "#000";
  faceCtx.fillRect(0, 0, FACE, FACE);
  faceCtx.drawImage(bitmap, cx - side / 2, cy - side / 2, side, side, 0, 0, FACE, FACE);
  const { data } = faceCtx.getImageData(0, 0, FACE, FACE);
  const area = FACE * FACE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) input[c * area + i] = (data[i * 4 + 2 - c] / 255 - MEAN[c]) / STD[c];
  }
  const out = (await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, FACE, FACE]) }))[
    session.outputNames[0]
  ].data;
  d.female = 1 / (1 + Math.exp(out[0] - out[1]));
  // One weak "female chest" box can be a man's shirt, so require a strong box or two of them.
  const body = all.filter((b) => FEMALE_BODY.has(b.label) && b.score >= 0.4 && isBelow(d, b));
  d.femaleBody = body.length >= 2 || body.some((b) => b.score >= 0.7);
  d.label = d.female >= 0.5 || d.femaleBody ? "FACE_FEMALE" : "FACE_MALE";
}

// Body box b sits under face f: horizontally near the face and starting within ~4 face heights below.
function isBelow(f, b) {
  const fcx = f.x + f.w / 2, bcx = b.x + b.w / 2;
  return Math.abs(bcx - fcx) < f.w * 1.5 && b.y > f.y + f.h * 0.5 && b.y < f.y + f.h * 5;
}

function nms(boxes) {
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const b of boxes) {
    if (kept.every((k) => iou(k, b) < NMS_IOU)) kept.push(b);
  }
  return kept;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
