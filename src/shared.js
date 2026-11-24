// Shared constants. Loaded as a classic script by the content script, popup, offscreen page and service worker.

// Output classes of the NudeNet 320n detector, in model order.
const SS_LABELS = [
  "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED", "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED", "FEET_EXPOSED",
  "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE",
  "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED"
];

// User-facing targets, each a group of detector labels.
const SS_TARGETS = {
  femaleFace: { title: "Female faces", labels: ["FACE_FEMALE"], on: true },
  femaleChest: { title: "Chest / cleavage (clothed)", labels: ["FEMALE_BREAST_COVERED"], on: true },
  nudity: {
    title: "Explicit nudity",
    labels: ["FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED", "ANUS_EXPOSED"],
    on: true
  },
  lowerBody: { title: "Hips / buttocks (clothed)", labels: ["BUTTOCKS_COVERED", "FEMALE_GENITALIA_COVERED", "ANUS_COVERED"], on: true },
  belly: { title: "Belly", labels: ["BELLY_COVERED", "BELLY_EXPOSED"], on: false },
  maleFace: { title: "Male faces", labels: ["FACE_MALE"], on: false },
  maleChest: { title: "Bare male chest", labels: ["MALE_BREAST_EXPOSED"], on: false }
};

// Minimum detector score per sensitivity level.
const SS_THRESHOLDS = { low: 0.5, medium: 0.35, high: 0.25 };

// Minimum gender-model probability for a face to count as female. Tilted towards "female" because
// men almost always score near 0, while missed women often land in the 0.3-0.5 range.
const SS_FEMALE_THRESHOLDS = { low: 0.5, medium: 0.35, high: 0.2 };

// Final face label: the gender model's probability, or a female body detected under the face.
function ssFaceLabel(d, sensitivity) {
  if (d.female == null) return d.label;
  const t = SS_FEMALE_THRESHOLDS[sensitivity] ?? SS_FEMALE_THRESHOLDS.medium;
  return d.femaleBody || d.female >= t ? "FACE_FEMALE" : "FACE_MALE";
}

const SS_DEFAULTS = {
  enabled: true,
  sensitivity: "medium",
  maskStyle: "blur", // "blur" | "solid" | "image"
  maskColor: "#111827",
  maskImage: null, // PNG data URL chosen by the user; null = bundled flower
  hideUntilScanned: true,
  targets: Object.fromEntries(Object.entries(SS_TARGETS).map(([k, t]) => [k, t.on])),
  pausedSites: []
};

async function ssLoadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(SS_DEFAULTS));
  return { ...SS_DEFAULTS, ...stored, targets: { ...SS_DEFAULTS.targets, ...stored.targets } };
}
