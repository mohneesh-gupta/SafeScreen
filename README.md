# SafeScreen

SafeScreen is a Windows-first Electron desktop app that masks unwanted screen
content in near real time using a transparent overlay window. The project is
structured so capture, inference, overlay rendering, and controls stay decoupled
for future model upgrades and cross-platform work.

## What is implemented

- Electron + React + TypeScript application shell
- Shared runtime contracts for settings, frames, detections, and overlay masks
- Local settings persistence with `electron-store`
- Primary-display capture loop using `desktopCapturer`
- Worker-thread inference pipeline backed by a local Hugging Face / ONNX NSFW classifier
- Tile-based region scoring to turn image classification into on-screen mask regions
- Transparent always-on-top overlay window with smoothed pixelated masks
- Tray controls and a minimal desktop control panel

## Current model behavior

The app now uses a real local image-classification model. By default it loads
`onnx-community/nsfw_image_detection-ONNX` with `q4` quantization through
Transformers.js and caches model files in `.cache/transformers`.

On the first run, SafeScreen may download the model once. After that, inference
runs locally from the cache.

To prefetch the model before launching the app:

```powershell
npm run download:model
```

You can also customize the model source:

```powershell
$env:SAFE_SCREEN_MODEL_ID="onnx-community/nsfw_image_detection-ONNX"
$env:SAFE_SCREEN_MODEL_DTYPE="q4"
npm run dev
```

## Development

Install dependencies and start the app:

```powershell
npm install
npm run dev
```

For a production build:

```powershell
npm run build
```

## Important limitations

- The app uses an overlay window; it does not rewrite pixels inside other apps.
- Some protected or DRM-controlled surfaces may not be capturable.
- The current detector is a tile-based image classifier, so localization is
  approximate rather than object-perfect.
- Face-specific blocking is not implemented in this MVP.
