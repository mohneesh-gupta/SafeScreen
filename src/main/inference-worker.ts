import { parentPort } from "node:worker_threads";
import path from "node:path";
import { PNG } from "pngjs";
import type {
  BoundingBox,
  CaptureFrame,
  DetectionHit,
  InferenceRequest,
  InferenceWorkerMessage,
  SensitivityLevel
} from "../shared/contracts.js";

type ClassificationLabel = {
  label: string;
  score: number;
};

type ClassificationOutput = ClassificationLabel[] | ClassificationLabel[][];

type Classifier = (
  image: unknown | unknown[],
  options?: { top_k?: number }
) => Promise<ClassificationOutput>;

type ModelDtype = "q4" | "q8" | "fp32";

const DEFAULT_MODEL_ID = "onnx-community/nsfw_image_detection-ONNX";
const DEFAULT_DTYPE = "q4";
const CACHE_DIR = path.resolve(process.cwd(), ".cache", "transformers");
const MIN_REGION_DIMENSION = 128;

let classifier: Classifier | null = null;
let transformersModule: any | null = null;
let modelInfo = "Loading local NSFW classifier...";

function thresholdForSensitivity(level: SensitivityLevel) {
  switch (level) {
    case "low":
      return 0.8;
    case "high":
      return 0.52;
    case "medium":
    default:
      return 0.66;
  }
}

function reportModelInfo(next: string) {
  modelInfo = next;
}

async function loadClassifier(): Promise<void> {
  reportModelInfo("Loading NSFW model. First launch may download weights...");

  const transformers = (await import("@huggingface/transformers")) as any;
  transformersModule = transformers;
  const { pipeline, env } = transformers;

  env.cacheDir = process.env.SAFE_SCREEN_MODEL_CACHE_DIR || CACHE_DIR;

  const localModelPath = process.env.SAFE_SCREEN_LOCAL_MODEL_DIR;
  if (localModelPath) {
    env.localModelPath = localModelPath;
    env.allowRemoteModels = false;
  } else {
    env.allowRemoteModels =
      process.env.SAFE_SCREEN_ALLOW_REMOTE_MODELS !== "false";
  }

  const modelId = process.env.SAFE_SCREEN_MODEL_ID || DEFAULT_MODEL_ID;
  const dtype = (
    process.env.SAFE_SCREEN_MODEL_DTYPE || DEFAULT_DTYPE
  ) as ModelDtype;

  classifier = (await pipeline("image-classification", modelId, {
    dtype,
    device: "cpu"
  })) as Classifier;

  reportModelInfo(
    `Loaded ${modelId} (${dtype}) with cache at ${env.cacheDir}`
  );
}

function clampBox(frame: CaptureFrame, box: BoundingBox): BoundingBox {
  const x = Math.max(0, Math.min(Math.round(box.x), frame.width - 1));
  const y = Math.max(0, Math.min(Math.round(box.y), frame.height - 1));
  const width = Math.max(
    1,
    Math.min(Math.round(box.width), frame.width - x)
  );
  const height = Math.max(
    1,
    Math.min(Math.round(box.height), frame.height - y)
  );

  return { x, y, width, height };
}

function isRefinable(box: BoundingBox) {
  return box.width >= MIN_REGION_DIMENSION * 2 && box.height >= MIN_REGION_DIMENSION * 2;
}

function splitIntoQuadrants(box: BoundingBox): BoundingBox[] {
  const halfWidth = Math.max(1, Math.round(box.width / 2));
  const halfHeight = Math.max(1, Math.round(box.height / 2));
  const rightWidth = Math.max(1, box.width - halfWidth);
  const bottomHeight = Math.max(1, box.height - halfHeight);

  return [
    { x: box.x, y: box.y, width: halfWidth, height: halfHeight },
    { x: box.x + halfWidth, y: box.y, width: rightWidth, height: halfHeight },
    { x: box.x, y: box.y + halfHeight, width: halfWidth, height: bottomHeight },
    {
      x: box.x + halfWidth,
      y: box.y + halfHeight,
      width: rightWidth,
      height: bottomHeight
    }
  ];
}

function buildCoarseRegions(frame: CaptureFrame): BoundingBox[] {
  const full: BoundingBox = {
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height
  };

  const quadrants = splitIntoQuadrants(full);
  const centerWidth = Math.max(MIN_REGION_DIMENSION, Math.round(frame.width * 0.5));
  const centerHeight = Math.max(
    MIN_REGION_DIMENSION,
    Math.round(frame.height * 0.58)
  );

  const center: BoundingBox = {
    x: Math.max(0, Math.round((frame.width - centerWidth) / 2)),
    y: Math.max(0, Math.round((frame.height - centerHeight) / 2)),
    width: Math.min(centerWidth, frame.width),
    height: Math.min(centerHeight, frame.height)
  };

  return [...quadrants, center];
}

function iou(a: BoundingBox, b: BoundingBox) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const overlapWidth = Math.max(0, x2 - x1);
  const overlapHeight = Math.max(0, y2 - y1);
  const intersection = overlapWidth * overlapHeight;

  if (intersection === 0) {
    return 0;
  }

  const union = a.width * a.height + b.width * b.height - intersection;
  return intersection / union;
}

function mergeHits(hits: DetectionHit[]): DetectionHit[] {
  const sorted = [...hits].sort((a, b) => b.confidence - a.confidence);
  const merged: DetectionHit[] = [];

  for (const hit of sorted) {
    const existing = merged.find((candidate) => iou(candidate.box, hit.box) >= 0.3);
    if (!existing) {
      merged.push(hit);
      continue;
    }

    existing.confidence = Math.max(existing.confidence, hit.confidence);
    const x1 = Math.min(existing.box.x, hit.box.x);
    const y1 = Math.min(existing.box.y, hit.box.y);
    const x2 = Math.max(
      existing.box.x + existing.box.width,
      hit.box.x + hit.box.width
    );
    const y2 = Math.max(
      existing.box.y + existing.box.height,
      hit.box.y + hit.box.height
    );
    existing.box = {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1
    };
  }

  return merged;
}

function extractRegionRgba(frame: CaptureFrame, box: BoundingBox): Uint8Array {
  const clamped = clampBox(frame, box);
  const source = new Uint8Array(frame.bitmap);
  const pixels = new Uint8Array(clamped.width * clamped.height * 4);

  for (let y = 0; y < clamped.height; y += 1) {
    for (let x = 0; x < clamped.width; x += 1) {
      const src = ((clamped.y + y) * frame.width + (clamped.x + x)) * 4;
      const dst = (y * clamped.width + x) * 4;

      pixels[dst] = source[src + 2];
      pixels[dst + 1] = source[src + 1];
      pixels[dst + 2] = source[src];
      pixels[dst + 3] = source[src + 3];
    }
  }

  return pixels;
}

async function regionToImage(frame: CaptureFrame, box: BoundingBox) {
  if (!transformersModule) {
    throw new Error("Transformers module is not loaded.");
  }

  const clamped = clampBox(frame, box);
  const rgba = extractRegionRgba(frame, clamped);
  const png = PNG.sync.write({
    width: clamped.width,
    height: clamped.height,
    data: Buffer.from(rgba)
  });

  const blobBytes = Uint8Array.from(png);

  return transformersModule.RawImage.fromBlob(
    new globalThis.Blob([blobBytes], { type: "image/png" })
  );
}

function nsfwScore(labels: ClassificationLabel[]): number {
  return (
    labels.find((entry) => entry.label.toLowerCase() === "nsfw")?.score ?? 0
  );
}

function normalizeClassificationOutput(
  output: ClassificationOutput
): ClassificationLabel[][] {
  if (!Array.isArray(output) || output.length === 0) {
    return [];
  }

  if (Array.isArray(output[0])) {
    return output as ClassificationLabel[][];
  }

  return [output as ClassificationLabel[]];
}

async function scoreRegions(
  frame: CaptureFrame,
  boxes: BoundingBox[]
): Promise<number[]> {
  if (!classifier) {
    throw new Error("Classifier is not loaded.");
  }

  if (boxes.length === 0) {
    return [];
  }

  const images = await Promise.all(
    boxes.map((box) => regionToImage(frame, box))
  );

  const output = await classifier(images, { top_k: 2 });
  const labelsByImage = normalizeClassificationOutput(output);

  return images.map((_image, index) => nsfwScore(labelsByImage[index] || []));
}

async function detect(frame: CaptureFrame, sensitivity: SensitivityLevel) {
  if (!classifier) {
    throw new Error("Classifier is not loaded.");
  }

  const threshold = thresholdForSensitivity(sensitivity);
  const coarseRegions = buildCoarseRegions(frame);
  const hits: DetectionHit[] = [];
  const positiveCoarse: Array<{ box: BoundingBox; score: number }> = [];
  const coarseScores = await scoreRegions(frame, coarseRegions);

  for (let index = 0; index < coarseRegions.length; index += 1) {
    const region = coarseRegions[index];
    const score = coarseScores[index] ?? 0;
    if (score >= threshold) {
      positiveCoarse.push({ box: region, score });
    }
  }

  const refinableEntries = positiveCoarse
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isRefinable(entry.box));

  const refinedRequests: Array<{ parentIndex: number; box: BoundingBox }> = [];
  for (const { entry, index } of refinableEntries) {
    for (const box of splitIntoQuadrants(entry.box)) {
      refinedRequests.push({ parentIndex: index, box });
    }
  }

  const refinedScores = await scoreRegions(
    frame,
    refinedRequests.map((request) => request.box)
  );

  const refinedHitsByParent = new Map<number, DetectionHit[]>();
  for (let index = 0; index < refinedRequests.length; index += 1) {
    const request = refinedRequests[index];
    const refinedScore = refinedScores[index] ?? 0;
    if (refinedScore < threshold) {
      continue;
    }

    const nextHit: DetectionHit = {
      id: `${frame.id}-refined-${index}`,
      label: "sexualized_content",
      confidence: refinedScore,
      box: request.box
    };

    const existing = refinedHitsByParent.get(request.parentIndex) || [];
    existing.push(nextHit);
    refinedHitsByParent.set(request.parentIndex, existing);
  }

  for (let index = 0; index < positiveCoarse.length; index += 1) {
    const entry = positiveCoarse[index];
    if (!isRefinable(entry.box)) {
      hits.push({
        id: `${frame.id}-${hits.length}`,
        label: "sexualized_content",
        confidence: entry.score,
        box: entry.box
      });
      continue;
    }

    const refinedHits = refinedHitsByParent.get(index) || [];
    if (refinedHits.length === 0) {
      hits.push({
        id: `${frame.id}-${hits.length}`,
        label: "sexualized_content",
        confidence: entry.score,
        box: entry.box
      });
      continue;
    }

    hits.push(...refinedHits);
  }

  return mergeHits(hits);
}

async function bootstrap() {
  try {
    await loadClassifier();
    const ready: InferenceWorkerMessage = {
      type: "ready",
      modelInfo
    };
    parentPort?.postMessage(ready);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model bootstrap failed";
    reportModelInfo(`Failed to load NSFW model: ${message}`);
    const ready: InferenceWorkerMessage = {
      type: "ready",
      modelInfo
    };
    parentPort?.postMessage(ready);
  }
}

parentPort?.on("message", async (message: InferenceRequest) => {
  if (message.type !== "detect") {
    return;
  }

  try {
    const hits = message.settings.rules.sexualContent
      ? await detect(message.frame, message.settings.sensitivity)
      : [];
    const response: InferenceWorkerMessage = {
      type: "result",
      hits,
      modelInfo
    };
    parentPort?.postMessage(response);
  } catch (error) {
    const response: InferenceWorkerMessage = {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown inference error"
    };
    parentPort?.postMessage(response);
  }
});

void bootstrap();
