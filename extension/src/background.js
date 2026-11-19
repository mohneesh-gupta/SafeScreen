importScripts("shared.js");

// The service worker only routes messages; inference lives in a single offscreen document
// so the model is loaded once and shared by every tab.
let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "Run the on-device image detector" })
    .finally(() => (creating = null));
  await creating;
}

async function defaultMaskImage() {
  const buf = await (await fetch(chrome.runtime.getURL("assets/flower.png"))).arrayBuffer();
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return "data:image/png;base64," + btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "ss-detect") {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ ...msg, target: "offscreen" }))
      .then(reply, (e) => reply({ error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "ss-default-image") {
    defaultMaskImage().then(reply, () => reply(null));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // Fill in any settings that don't exist yet without overwriting user choices.
  await chrome.storage.local.set(await ssLoadSettings());
});
