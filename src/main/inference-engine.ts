import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type {
  CaptureFrame,
  DetectionHit,
  InferenceEngine,
  InferenceRequest,
  InferenceWorkerMessage,
  UserSettings
} from "../shared/contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WorkerInferenceEngine implements InferenceEngine {
  private readonly worker = new Worker(
    path.join(__dirname, "inference-worker.js")
  );
  private readonly ready: Promise<void>;
  private modelInfo = "Starting inference worker...";
  private queue = Promise.resolve();

  constructor(
    private readonly onModelInfo: (modelInfo: string) => void,
    private readonly onError: (message: string) => void
  ) {
    this.ready = new Promise((resolve) => {
      this.worker.once("message", (message: InferenceWorkerMessage) => {
        if (message.type === "ready") {
          this.modelInfo = message.modelInfo;
          this.onModelInfo(this.modelInfo);
        }
        resolve();
      });
    });

    this.worker.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Worker failure";
      this.onError(message);
    });
  }

  async load(): Promise<void> {
    await this.ready;
  }

  async detect(
    frame: CaptureFrame,
    settings: UserSettings
  ): Promise<DetectionHit[]> {
    await this.ready;

    const request: InferenceRequest = {
      type: "detect",
      frame,
      settings
    };

    const job = this.queue.then(
      () =>
        new Promise<DetectionHit[]>((resolve, reject) => {
          const listener = (message: InferenceWorkerMessage) => {
            if (message.type === "ready") {
              this.modelInfo = message.modelInfo;
              this.onModelInfo(this.modelInfo);
              return;
            }

            this.worker.off("message", listener);
            if (message.type === "error") {
              reject(new Error(message.error));
              return;
            }

            if (message.modelInfo && message.modelInfo !== this.modelInfo) {
              this.modelInfo = message.modelInfo;
              this.onModelInfo(this.modelInfo);
            }

            resolve(message.hits);
          };

          this.worker.on("message", listener);
          this.worker.postMessage(request);
        })
    );

    this.queue = job.then(
      () => undefined,
      () => undefined
    );

    return job;
  }

  dispose(): void {
    void this.worker.terminate();
  }
}
