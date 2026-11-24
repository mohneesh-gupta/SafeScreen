const $ = (id) => document.getElementById(id);
const SENS_HINT = {
  low: "Only hides clear, confident detections.",
  medium: "Balanced default.",
  high: "Hides more, including uncertain detections."
};
let settings;
let host = null;

const save = (patch) => chrome.storage.local.set(patch);

function render() {
  document.body.classList.toggle("off", !settings.enabled);
  $("enabled").checked = settings.enabled;
  $("hideUntilScanned").checked = settings.hideUntilScanned;
  $("pauseSite").checked = host != null && settings.pausedSites.includes(host);
  $("pauseSite").disabled = host == null;
  for (const seg of ["sensitivity", "maskStyle"]) {
    for (const b of $(seg).children) b.classList.toggle("on", b.dataset.v === settings[seg]);
  }
  $("sensHint").textContent = SENS_HINT[settings.sensitivity];
  $("solidOpts").classList.toggle("show", settings.maskStyle === "solid");
  $("imageOpts").classList.toggle("show", settings.maskStyle === "image");
  $("maskColor").value = settings.maskColor;
  $("preview").src = settings.maskImage || "assets/flower.png";
  for (const [key, input] of Object.entries(targetInputs)) input.checked = !!settings.targets[key];
}

const targetInputs = {};
for (const [key, t] of Object.entries(SS_TARGETS)) {
  const label = document.createElement("label");
  label.className = "row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.onchange = () => save({ targets: { ...settings.targets, [key]: input.checked } });
  label.append(input, " " + t.title);
  $("targets").append(label);
  targetInputs[key] = input;
}

$("enabled").onchange = (e) => save({ enabled: e.target.checked });
$("hideUntilScanned").onchange = (e) => save({ hideUntilScanned: e.target.checked });
$("maskColor").oninput = (e) => save({ maskColor: e.target.value });
$("resetImage").onclick = () => save({ maskImage: null });
$("pauseSite").onchange = (e) => {
  const others = settings.pausedSites.filter((h) => h !== host);
  save({ pausedSites: e.target.checked ? [...others, host] : others });
};
for (const seg of ["sensitivity", "maskStyle"]) {
  $(seg).onclick = (e) => e.target.dataset.v && save({ [seg]: e.target.dataset.v });
}

// Downscale the chosen image so it fits comfortably in extension storage.
$("file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bitmap = await createImageBitmap(file);
  const s = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  save({ maskImage: canvas.toDataURL("image/png"), maskStyle: "image" });
};

chrome.storage.onChanged.addListener(async () => {
  settings = await ssLoadSettings();
  render();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol.startsWith("http")) host = url.hostname;
  } catch {}
  if (host) $("host").textContent = host;
  settings = await ssLoadSettings();
  render();
})();
