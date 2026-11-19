import { app } from "electron";
import { randomUUID } from "node:crypto";
import type {
  CaptureFrame,
  DetectionHit,
  FaceProfile,
  RuntimeSnapshot,
  UserSettings
} from "../shared/contracts.js";
import { defaultSnapshot } from "../shared/defaults.js";
import { CaptureService } from "./capture-service.js";
import { WorkerInferenceEngine } from "./inference-engine.js";
import { MaskTracker } from "./mask-tracker.js";
import { OverlayController } from "./overlay-controller.js";
import { SettingsStore } from "./settings-store.js";

const TARGET_LOOP_MS = 260;
const PAUSED_LOOP_MS = 550;
const BUSY_LOOP_MS = 60;
const MAX_SINGLE_MASK_AREA_RATIO = 0.22;
const MAX_TOTAL_MASK_AREA_RATIO = 0.38;

export class RuntimeController {
  private readonly settingsStore = new SettingsStore();
  private readonly captureService = new CaptureService();
  private readonly maskTracker = new MaskTracker();
  private readonly inference = new WorkerInferenceEngine(
    (modelInfo: string) => {
      this.snapshot.modelInfo = modelInfo;
      if (modelInfo.toLowerCase().startsWith("failed")) {
        this.snapshot.status = "error";
      } else if (this.snapshot.status === "model_loading") {
        this.snapshot.status = this.snapshot.settings.enabled
          ? "enabled"
          : "paused";
      }
      this.publish();
    },
    (message: string) => {
      this.snapshot.status = "error";
      this.snapshot.modelInfo = message;
      this.publish();
    }
  );

  private snapshot: RuntimeSnapshot = {
    ...defaultSnapshot,
    settings: {
      ...this.settingsStore.get(),
      enabled: false
    }
  };
  private timer: NodeJS.Timeout | null = null;
  private isStopped = false;
  private isTickRunning = false;
  private frameCounter = 0;
  private frameWindowStartedAt = Date.now();

  constructor(
    private readonly overlayController: OverlayController,
    private readonly onSnapshot: (snapshot: RuntimeSnapshot) => void
  ) {}

  async start(): Promise<void> {
    this.isStopped = false;
    await this.inference.load();
    app.setLoginItemSettings({
      openAtLogin: this.snapshot.settings.launchOnStartup
    });
    this.snapshot.status = this.snapshot.settings.enabled ? "enabled" : "paused";
    this.publish();
    this.scheduleNextTick(0);
  }

  stop(): void {
    this.isStopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.inference.dispose();
  }

  getSnapshot(): RuntimeSnapshot {
    return structuredClone(this.snapshot);
  }

  async updateSettings(next: Partial<UserSettings>): Promise<RuntimeSnapshot> {
    const merged = {
      ...this.snapshot.settings,
      ...next
    };

    this.snapshot.settings = merged;
    this.settingsStore.set(merged);

    app.setLoginItemSettings({
      openAtLogin: merged.launchOnStartup
    });

    if (!merged.enabled) {
      this.snapshot.status = "paused";
      this.snapshot.masks = this.maskTracker.clear();
      this.overlayController.clear();
    } else if (this.snapshot.status === "paused") {
      this.snapshot.status = "enabled";
      this.scheduleNextTick(0);
    }

    this.publish();
    return this.getSnapshot();
  }

  async addFaceProfile(
    name: string,
    imagePaths: string[]
  ): Promise<RuntimeSnapshot> {
    const trimmedName = name.trim();
    if (!trimmedName || imagePaths.length === 0) {
      return this.getSnapshot();
    }

    const profile: FaceProfile = {
      id: randomUUID(),
      name: trimmedName,
      imagePaths,
      enabled: true,
      status: "needs_model",
      createdAt: Date.now()
    };

    return this.updateSettings({
      faceProfiles: [...this.snapshot.settings.faceProfiles, profile],
      rules: {
        ...this.snapshot.settings.rules,
        blockedFaces: true
      }
    });
  }

  async removeFaceProfile(id: string): Promise<RuntimeSnapshot> {
    const faceProfiles = this.snapshot.settings.faceProfiles.filter(
      (profile) => profile.id !== id
    );

    return this.updateSettings({
      faceProfiles,
      rules: {
        ...this.snapshot.settings.rules,
        blockedFaces:
          faceProfiles.length > 0 && this.snapshot.settings.rules.blockedFaces
      }
    });
  }

  private async tick(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    if (!this.snapshot.settings.enabled) {
      this.scheduleNextTick(PAUSED_LOOP_MS);
      return;
    }

    if (this.isTickRunning) {
      this.scheduleNextTick(BUSY_LOOP_MS);
      return;
    }

    const tickStartedAt = Date.now();
    this.isTickRunning = true;
    try {
      const frame = await this.captureService.capturePrimaryDisplayFrame();
      let hits: DetectionHit[];

      try {
        hits = await this.inference.detect(frame, this.snapshot.settings);
      } catch (error) {
        this.snapshot.status = "error";
        this.snapshot.modelInfo =
          error instanceof Error ? error.message : "Inference failed";
        this.snapshot.masks = this.maskTracker.clear();
        this.overlayController.clear();
        this.publish();
        return;
      }

      if (!this.snapshot.settings.enabled) {
        return;
      }

      const scaledHits = this.filterOverbroadHits(
        frame,
        this.scaleHitsToDisplay(frame, hits)
      );
      this.snapshot.masks = this.maskTracker.update(
        scaledHits,
        this.snapshot.settings.maskStyle
      );
      this.snapshot.status = "enabled";
      this.snapshot.lastUpdatedAt = Date.now();
      this.overlayController.setMasks(this.snapshot.masks);
      this.trackFrameRate();
      this.publish();
    } catch (error) {
      this.snapshot.status = "capture_blocked";
      this.snapshot.modelInfo =
        error instanceof Error ? error.message : "Screen capture failed";
      this.snapshot.masks = this.maskTracker.clear();
      this.overlayController.clear();
      this.publish();
    } finally {
      this.isTickRunning = false;
      if (!this.isStopped) {
        const elapsed = Date.now() - tickStartedAt;
        const nextDelay = Math.max(0, TARGET_LOOP_MS - elapsed);
        this.scheduleNextTick(nextDelay);
      }
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.isStopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
  }

  private scaleHitsToDisplay(
    frame: CaptureFrame,
    hits: DetectionHit[]
  ): DetectionHit[] {
    if (hits.length === 0) {
      return hits;
    }

    const scaleX = frame.displayWidth / frame.width;
    const scaleY = frame.displayHeight / frame.height;
    if (
      Number.isNaN(scaleX) ||
      Number.isNaN(scaleY) ||
      scaleX <= 0 ||
      scaleY <= 0
    ) {
      return hits;
    }

    return hits.map((hit) => {
      const scaledX = hit.box.x * scaleX;
      const scaledY = hit.box.y * scaleY;
      const scaledWidth = hit.box.width * scaleX;
      const scaledHeight = hit.box.height * scaleY;

      const x = Math.max(0, Math.min(scaledX, frame.displayWidth - 1));
      const y = Math.max(0, Math.min(scaledY, frame.displayHeight - 1));
      const width = Math.max(1, Math.min(scaledWidth, frame.displayWidth - x));
      const height = Math.max(
        1,
        Math.min(scaledHeight, frame.displayHeight - y)
      );

      return {
        ...hit,
        box: {
          x,
          y,
          width,
          height
        }
      };
    });
  }

  private filterOverbroadHits(
    frame: CaptureFrame,
    hits: DetectionHit[]
  ): DetectionHit[] {
    const displayArea = frame.displayWidth * frame.displayHeight;
    const maxSingleArea = displayArea * MAX_SINGLE_MASK_AREA_RATIO;
    const maxTotalArea = displayArea * MAX_TOTAL_MASK_AREA_RATIO;
    let totalArea = 0;

    return [...hits]
      .sort((a, b) => b.confidence - a.confidence)
      .filter((hit) => {
        const area = hit.box.width * hit.box.height;
        if (area > maxSingleArea || totalArea + area > maxTotalArea) {
          return false;
        }

        totalArea += area;
        return true;
      });
  }

  private trackFrameRate(): void {
    this.frameCounter += 1;
    const now = Date.now();
    const elapsed = now - this.frameWindowStartedAt;
    if (elapsed < 1000) {
      return;
    }

    this.snapshot.frameRate = Number(
      ((this.frameCounter / elapsed) * 1000).toFixed(1)
    );
    this.frameCounter = 0;
    this.frameWindowStartedAt = now;
  }

  private publish(): void {
    const snapshot = this.getSnapshot();
    this.onSnapshot(snapshot);
  }
}
