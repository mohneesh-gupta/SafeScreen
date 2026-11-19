import { desktopCapturer, screen, nativeImage } from "electron";
import type { CaptureFrame, ScreenSource } from "../shared/contracts.js";

export class CaptureService {
  async listSources(): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
      thumbnailSize: { width: 320, height: 180 }
    });

    return sources.map((source) => {
      const displayId = source.display_id || source.id.split(":").pop() || "0";
      return {
        id: source.id,
        name: source.name,
        displayId
      };
    });
  }

  async capturePrimaryDisplayFrame(): Promise<CaptureFrame> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const displayWidth = Math.max(1, primaryDisplay.bounds.width);
    const displayHeight = Math.max(1, primaryDisplay.bounds.height);
    const thumbnailSize = {
      width: Math.max(640, Math.round(displayWidth / 2)),
      height: Math.max(360, Math.round(displayHeight / 2))
    };

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
      thumbnailSize
    });

    const source =
      sources.find((entry) => entry.display_id === String(primaryDisplay.id)) ??
      sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Unable to capture the primary display.");
    }

    const bitmap = source.thumbnail.toBitmap();
    const image = nativeImage.createFromBitmap(
      bitmap,
      source.thumbnail.getSize()
    );
    const { width, height } = image.getSize();

    return {
      id: `frame-${Date.now()}`,
      timestamp: Date.now(),
      displayId: source.display_id || String(primaryDisplay.id),
      width,
      height,
      displayWidth,
      displayHeight,
      bitmap: Uint8Array.from(bitmap).buffer
    };
  }
}
