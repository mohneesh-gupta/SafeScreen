import type { RuntimeSnapshot, UserSettings } from "./contracts.js";

export const defaultSettings: UserSettings = {
  enabled: false,
  sensitivity: "medium",
  launchOnStartup: false,
  maskStyle: "pixelate",
  rules: {
    sexualContent: true,
    blockedFaces: false
  },
  faceProfiles: []
};

export const defaultSnapshot: RuntimeSnapshot = {
  settings: defaultSettings,
  status: "model_loading",
  masks: [],
  modelInfo: "Booting local inference pipeline...",
  frameRate: 0,
  lastUpdatedAt: null
};
