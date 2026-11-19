export type SensitivityLevel = "low" | "medium" | "high";
export type MaskStyle = "pixelate" | "blur" | "solid";
export type DetectionLabel = "sexualized_content" | "blocked_face";
export type FaceProfileStatus = "ready" | "needs_model";

export type RuntimeStatus =
  | "enabled"
  | "paused"
  | "model_loading"
  | "capture_blocked"
  | "error";

export interface ProtectionRules {
  sexualContent: boolean;
  blockedFaces: boolean;
}

export interface FaceProfile {
  id: string;
  name: string;
  imagePaths: string[];
  enabled: boolean;
  status: FaceProfileStatus;
  createdAt: number;
}

export interface UserSettings {
  enabled: boolean;
  sensitivity: SensitivityLevel;
  launchOnStartup: boolean;
  maskStyle: MaskStyle;
  rules: ProtectionRules;
  faceProfiles: FaceProfile[];
}

export interface CaptureFrame {
  id: string;
  timestamp: number;
  displayId: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  bitmap: ArrayBuffer;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionHit {
  id: string;
  label: DetectionLabel;
  confidence: number;
  box: BoundingBox;
}

export interface OverlayMask {
  trackingId: string;
  box: BoundingBox;
  style: MaskStyle;
  opacity: number;
}

export interface RuntimeSnapshot {
  settings: UserSettings;
  status: RuntimeStatus;
  masks: OverlayMask[];
  modelInfo: string;
  frameRate: number;
  lastUpdatedAt: number | null;
}

export interface InferenceRequest {
  type: "detect";
  frame: CaptureFrame;
  settings: UserSettings;
}

export interface InferenceSuccess {
  type: "result";
  hits: DetectionHit[];
  modelInfo?: string;
}

export interface InferenceFailure {
  type: "error";
  error: string;
}

export interface InferenceReady {
  type: "ready";
  modelInfo: string;
}

export type InferenceWorkerMessage =
  | InferenceSuccess
  | InferenceFailure
  | InferenceReady;

export interface InferenceEngine {
  load(): Promise<void>;
  detect(
    frame: CaptureFrame,
    settings: UserSettings
  ): Promise<DetectionHit[]>;
}

export interface ScreenSource {
  id: string;
  name: string;
  displayId: string;
}

export interface SafeScreenApi {
  getSnapshot(): Promise<RuntimeSnapshot>;
  updateSettings(next: Partial<UserSettings>): Promise<RuntimeSnapshot>;
  chooseFaceProfileImages(name: string): Promise<RuntimeSnapshot>;
  removeFaceProfile(id: string): Promise<RuntimeSnapshot>;
  onSnapshot(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}
