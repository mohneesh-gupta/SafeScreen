// Copies the ONNX runtime into src/vendor and fetches the NudeNet 320n model into src/models.
// GitHub release assets now require login, so the model is taken from the official PyPI wheel.
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ortDist = `${root}node_modules/onnxruntime-web/dist/`;
const WHEEL_VERSION = "3.4.2";
const MODEL_ENTRY = "nudenet/320n.onnx";

await mkdir(`${root}src/vendor`, { recursive: true });
await mkdir(`${root}src/models`, { recursive: true });
for (const file of ["ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await copyFile(ortDist + file, `${root}src/vendor/${file}`);
}

const modelPath = `${root}src/models/320n.onnx`;
const size = await stat(modelPath).then((s) => s.size, () => 0);
if (size < 1_000_000) {
  console.log(`Downloading nudenet ${WHEEL_VERSION} wheel from PyPI...`);
  const meta = await (await fetch(`https://pypi.org/pypi/nudenet/${WHEEL_VERSION}/json`)).json();
  const wheel = meta.urls.find((u) => u.filename.endsWith(".whl"));
  const zip = Buffer.from(await (await fetch(wheel.url)).arrayBuffer());
  await writeFile(modelPath, extractZipEntry(zip, MODEL_ENTRY));
}
// Face gender classifier (Apache-2.0): https://huggingface.co/kunkunlin1221/face-gender-lcnet-050
const genderPath = `${root}src/models/gender_lcnet_050.onnx`;
if (!(await stat(genderPath).then(() => true, () => false))) {
  console.log("Downloading face gender model...");
  const res = await fetch("https://huggingface.co/kunkunlin1221/face-gender-lcnet-050/resolve/main/gender_detection_lcnet_050.onnx");
  if (!res.ok) throw new Error(`Gender model download failed: ${res.status}`);
  await writeFile(genderPath, Buffer.from(await res.arrayBuffer()));
}
console.log("Setup complete. Load the src folder as an unpacked extension.");

function extractZipEntry(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16); // central directory offset
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in wheel`);
}
