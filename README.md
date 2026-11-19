# SafeScreen

**See only what you choose to see.**

SafeScreen is a browser extension that automatically hides the parts of images and videos you don't
want on your screen, such as women's faces, cleavage or nudity. You decide what to hide and how to
cover it: a blur, a solid colour, or a picture you choose (a flower by default).

It works on any website, including YouTube, Instagram, Google/Bing Images, news sites and social
feeds. All detection runs **on your own computer**. No image ever leaves your device.

---

## Why SafeScreen?

Most content filters either block whole websites or hide entire images. SafeScreen is more precise:
it finds the specific region (a face, a chest area, …) and covers only that part, so you can keep
using the sites you need without seeing what you don't want to see.

**Use cases**

- **Personal discipline / guarding your gaze:** browse YouTube, Instagram or the news without
  being shown women's faces or revealing outfits.
- **Religious or cultural values:** keep everyday browsing in line with your own standards.
- **Distraction-free work and study:** stop suggestive thumbnails and ads from pulling your attention.
- **Safer browsing at home:** reduce exposure to explicit content on shared or family computers.

---

## What it does

- **Hides selected regions, not whole pages.** Only the detected face or body area is covered.
- **Tells men and women apart.** Male faces stay visible; only female faces are hidden (if you enable that).
- **Works on images and live video.** Videos are re-checked about 5 times per second while they play,
  including in fullscreen.
- **Hides first, shows later.** New images start blurred and are revealed only once they have been
  checked, so nothing flashes on screen before SafeScreen has looked at it.
- **Your choice of cover:** blur, solid colour, the default flower, or any image you upload.
- **Private by design:** the AI models run locally inside the extension; there are no servers and
  no accounts.

### What you can hide

| Option | Default |
| --- | --- |
| Female faces | On |
| Chest / cleavage (clothed) | On |
| Explicit nudity | On |
| Hips / buttocks (clothed) | On |
| Belly | Off |
| Male faces | Off |
| Bare male chest | Off |

---

## Setup

### Requirements

- **Google Chrome, Microsoft Edge or Brave** (any recent version)
- **Node.js 18 or newer**, used once to download the AI models

### Install

1. Open a terminal in the project folder and run:

   ```powershell
   cd extension
   npm install
   npm run setup
   ```

   `npm run setup` downloads the two AI models (about 15 MB in total) into `extension/src/models`.

2. Open your browser's extensions page:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`

3. Turn on **Developer mode** (a toggle in the top-right corner, or the left sidebar in Edge).

4. Click **Load unpacked** and select the **`extension/src`** folder.

5. Pin SafeScreen to your toolbar: click the puzzle-piece icon, then the pin next to SafeScreen.

That's it. SafeScreen is now active on every website.

### Updating

After pulling new code, run `npm run setup` again inside `extension/`, then click the **reload ↻**
button on the SafeScreen card in `chrome://extensions`.

---

## How to use

Click the **SafeScreen icon** in the toolbar to open its settings. Changes apply instantly on
every open tab, with no reload needed.

| Setting | What it does |
| --- | --- |
| **On / Off** | Turns SafeScreen on or off everywhere. |
| **Pause on this site** | Turns SafeScreen off for the current website only. |
| **Hide** | Choose which faces or body areas to hide (see the table above). |
| **Sensitivity** | **Low:** hides only clear detections. **Medium** (recommended): balanced. **High:** hides more, including uncertain detections. |
| **Cover with** | **Blur**, **Colour** (pick any colour), or **Image** (the default flower, or click *Choose image…* to upload your own). |
| **Blur images until scanned** | Keeps new images blurred until they have been checked. Recommended on. |

**Tips**

- If something slips through, switch Sensitivity to **High**.
- If too much is being hidden (for example men's faces), switch to **Low** or check that
  **Male faces** is turned off.
- On a site you trust completely, use **Pause on this site**.

---

## How it works (in short)

1. As a page loads, SafeScreen blurs every image and video.
2. Each image, and each video frame several times a second, is checked by a local AI model
   ([NudeNet](https://github.com/notAI-tech/NudeNet)) that finds faces and body regions.
3. Every face is then checked by a second small model that decides male or female.
4. Clean images are un-blurred; only the regions you chose to hide stay covered, and the covers
   follow the content as you scroll.

A new image is typically checked in about 0.1–0.3 seconds.

Technical details, tests and file layout are in [`extension/README.md`](extension/README.md).

---

## Limitations

- **Not 100% accurate.** Gender is right about 9 times out of 10. Old black-and-white photos,
  children and side profiles are the weak spots. When unsure, SafeScreen leans towards hiding.
- **Very small images** (tiny round avatars of about 40 px) and very small faces in large group photos
  can be missed.
- **Background images** set through CSS, and content inside some embedded widgets, are not scanned yet.
- Some protected videos can't be read by the extension. These are blurred completely instead of
  partially.
- Works in Chromium-based browsers (Chrome, Edge, Brave). Firefox and Safari are not supported yet.

---

## Coming next: mobile app (Android & iOS)

The next version brings SafeScreen to phones, where most social media is used:

- **Android and iOS apps** that hide the same content inside apps like Instagram, YouTube and
  your browser, not only on websites.
- The same on-device AI and settings: choose what to hide and how to cover it, with nothing uploaded.
- Settings that stay in sync between your phone and the browser extension.

Other planned improvements:

- Better detection of small faces in group photos and busy thumbnails.
- Scanning CSS background images.
- Firefox support.
- Publishing to the Chrome Web Store and Edge Add-ons for one-click install.

---

## Project structure

```
safeScreen/
├── extension/          ← the SafeScreen browser extension (current product)
│   ├── src/            ← load this folder in the browser
│   ├── scripts/        ← setup (model download) and asset generation
│   └── test/           ← automated tests
└── src/, scripts/ …    ← earlier Electron desktop prototype (no longer maintained)
```

---

## License

SafeScreen uses the [NudeNet](https://github.com/notAI-tech/NudeNet) detector, which is licensed
under **AGPL-3.0**. Anyone distributing SafeScreen must therefore also make its source code available
under AGPL-3.0. The face gender model
([face-gender-lcnet-050](https://huggingface.co/kunkunlin1221/face-gender-lcnet-050)) is Apache-2.0.
