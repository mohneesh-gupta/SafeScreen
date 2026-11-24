# SafeScreen browser extension

Hides the faces and body regions you choose in images and videos on any website (YouTube,
Instagram, news sites…), by blurring them, covering them with a colour, or replacing them with a
picture (a flower by default, or your own image). Detection runs fully on your device.

## Install (Chrome / Edge / Brave)

```powershell
npm install
npm run setup      # copies the ONNX runtime, downloads NudeNet (~12 MB) and the face gender model (~2.4 MB)
```

Then open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click
**Load unpacked** and pick the `src` folder. Click the SafeScreen toolbar icon for settings.

## How it works

| File | Role |
| --- | --- |
| `src/content.css` | Blurs every `<img>`/`<video>` from first paint until it has been scanned (fail-closed). |
| `src/content.js` | Finds media, sends images/video frames for detection, draws masks in a top-layer overlay that follows scrolling and fullscreen. Videos are re-checked every 200 ms. |
| `src/offscreen.js` | One shared detector for all tabs: NudeNet 320n (YOLOv8) on onnxruntime-web, multi-threaded WASM. Every face is then re-checked by a small gender classifier (LCNet-0.5). Fetches cross-origin images itself. |
| `src/background.js` | Creates the offscreen document and routes messages. |
| `src/popup.*` | Settings: on/off, pause per site, targets, sensitivity, cover style, custom image. |
| `src/shared.js` | Labels, targets, thresholds, default settings. |

## Male vs female faces

NudeNet alone labels almost every face as female, so each detected face is cropped and passed to
[face-gender-lcnet-050](https://huggingface.co/kunkunlin1221/face-gender-lcnet-050) (Apache-2.0,
~1 ms per face). A face counts as female if the gender model says so (cut-off depends on
sensitivity: 0.5 / 0.35 / 0.2), or if a clear female chest/body region is detected right below it.
This catches side profiles the face model misses. The cut-off leans towards "female": hiding a man
by mistake is preferred over showing a woman.

On 40 hand-labelled faces, 35 are classified correctly (88%). The remaining mistakes are mostly
1890s sepia photos and side profiles in crowded group shots.

## Tests

```powershell
npm test                 # end-to-end in Chrome for Testing (fixtures: test/out/fixtures/{woman,man,swimsuit,landscape}.jpg)
node test/gender.mjs     # gender accuracy on the faces in test/face-labels.json (fixtures in test/out/fixtures/)
node test/smoke-site.mjs "https://www.bing.com/images/search?q=anil+kapoor"
```

Screenshots are written to `test/out/`.

## Known limitations

- Gender is right about 9 times out of 10. Old photos, children and side profiles are the weak spots.
- Very small images (round ~40 px avatars) and small faces in large, busy images are often missed.
- CSS background images and media inside shadow DOM are not scanned.
- Cross-origin videos whose pixels can't be read are fully blurred instead of partially masked.
- **License:** the NudeNet model and code are AGPL-3.0. Publishing this extension means releasing its
  source under AGPL-3.0 as well. The gender model is Apache-2.0.
