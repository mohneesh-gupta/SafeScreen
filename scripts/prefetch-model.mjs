import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

const modelId = process.env.SAFE_SCREEN_MODEL_ID || "onnx-community/nsfw_image_detection-ONNX";
const dtype = process.env.SAFE_SCREEN_MODEL_DTYPE || "q4";
const cacheDir =
  process.env.SAFE_SCREEN_MODEL_CACHE_DIR ||
  path.resolve(process.cwd(), ".cache", "transformers");

env.cacheDir = cacheDir;
env.allowRemoteModels = process.env.SAFE_SCREEN_ALLOW_REMOTE_MODELS !== "false";

console.log(`Prefetching ${modelId} (${dtype}) into ${cacheDir} ...`);
await pipeline("image-classification", modelId, {
  dtype,
  device: "cpu"
});
console.log("Model ready.");
