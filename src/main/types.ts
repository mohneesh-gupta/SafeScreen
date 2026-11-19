import type { BrowserWindow } from "electron";
import type { RuntimeSnapshot, UserSettings } from "../shared/contracts.js";

export interface AppContext {
  mainWindow: BrowserWindow;
  overlayWindow: BrowserWindow;
  applySettings: (next: Partial<UserSettings>) => Promise<RuntimeSnapshot>;
  getSnapshot: () => RuntimeSnapshot;
}
