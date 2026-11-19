import Store from "electron-store";
import type { UserSettings } from "../shared/contracts.js";
import { defaultSettings } from "../shared/defaults.js";

type StoreShape = {
  settings: UserSettings;
};

export class SettingsStore {
  private readonly store = new Store<StoreShape>({
    name: "safe-screen",
    defaults: {
      settings: defaultSettings
    }
  });

  get(): UserSettings {
    return normalizeSettings(this.store.get("settings"));
  }

  set(next: UserSettings): void {
    this.store.set("settings", normalizeSettings(next));
  }
}

function normalizeSettings(settings: Partial<UserSettings>): UserSettings {
  return {
    ...defaultSettings,
    ...settings,
    rules: {
      ...defaultSettings.rules,
      ...settings.rules
    },
    faceProfiles: settings.faceProfiles || defaultSettings.faceProfiles
  };
}
