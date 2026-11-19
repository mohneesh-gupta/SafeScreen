import type { BrowserWindow } from "electron";
import type { OverlayMask } from "../shared/contracts.js";

export class OverlayController {
  constructor(private readonly overlayWindow: BrowserWindow) {}

  setMasks(masks: OverlayMask[]): void {
    this.overlayWindow.webContents.send("overlay:update-masks", masks);
  }

  clear(): void {
    this.setMasks([]);
  }
}
