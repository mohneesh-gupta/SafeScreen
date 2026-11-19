import { useMemo, useState } from "react";
import type {
  MaskStyle,
  RuntimeStatus,
  SensitivityLevel
} from "@shared/contracts";
import { useRuntimeSnapshot } from "../hooks/use-runtime-snapshot";

const statusCopy: Record<RuntimeStatus, string> = {
  enabled: "Protection is running and masking flagged regions.",
  paused: "Protection is paused. Screen content is not being masked.",
  model_loading: "The local inference worker is still loading.",
  capture_blocked: "Screen capture is unavailable. Check permissions or protected content.",
  error: "SafeScreen ran into an error and stopped masking content."
};

const sensitivityCopy: Record<SensitivityLevel, string> = {
  low: "Blocks mostly explicit material.",
  medium: "Balanced default for everyday browsing.",
  high: "Aggressively blocks suggestive content."
};

const maskStyleCopy: Record<MaskStyle, string> = {
  pixelate: "Pixel blocks with soft blur.",
  blur: "Heavy blur without scan lines.",
  solid: "Opaque shield for maximum concealment."
};

export function ControlPanel() {
  const {
    snapshot,
    isBooting,
    updateSettings,
    chooseFaceProfileImages,
    removeFaceProfile
  } = useRuntimeSnapshot();
  const [faceProfileName, setFaceProfileName] = useState("");

  const friendlyTime = useMemo(() => {
    if (!snapshot.lastUpdatedAt) {
      return "No frame processed yet";
    }

    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit"
    }).format(snapshot.lastUpdatedAt);
  }, [snapshot.lastUpdatedAt]);

  const updateRule = (
    rule: keyof typeof snapshot.settings.rules,
    enabled: boolean
  ) =>
    updateSettings({
      rules: {
        ...snapshot.settings.rules,
        [rule]: enabled
      }
    });

  const addFaceProfile = async () => {
    const name = faceProfileName.trim();
    if (!name) {
      return;
    }

    await chooseFaceProfileImages(name);
    setFaceProfileName("");
  };

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">SafeScreen MVP</div>
        <h1>Shape what reaches your eyes.</h1>
        <p>
          A local desktop protector that watches the visible screen and hides
          content that crosses your chosen sensitivity threshold.
        </p>
        <div className="hero-actions">
          <button
            className={snapshot.settings.enabled ? "primary" : "secondary"}
            onClick={() =>
              void updateSettings({ enabled: !snapshot.settings.enabled })
            }
          >
            {snapshot.settings.enabled ? "Pause protection" : "Enable protection"}
          </button>
          <span className={`status-chip status-${snapshot.status}`}>
            {snapshot.status.replace("_", " ")}
          </span>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Runtime</h2>
          <p>{statusCopy[snapshot.status]}</p>
          <dl className="stats">
            <div>
              <dt>Current masks</dt>
              <dd>{snapshot.masks.length}</dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd>{snapshot.frameRate || 0} fps</dd>
            </div>
            <div>
              <dt>Last update</dt>
              <dd>{friendlyTime}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Rules</h2>
          <label className="toggle-row">
            <span>Explicit and suggestive content</span>
            <input
              type="checkbox"
              checked={snapshot.settings.rules.sexualContent}
              onChange={(event) =>
                void updateRule("sexualContent", event.target.checked)
              }
            />
          </label>
          <label className="toggle-row">
            <span>Blocked face profiles</span>
            <input
              type="checkbox"
              checked={snapshot.settings.rules.blockedFaces}
              onChange={(event) =>
                void updateRule("blockedFaces", event.target.checked)
              }
            />
          </label>
          <p>
            Active rules decide which local detectors can create overlay masks.
          </p>
        </article>

        <article className="panel">
          <h2>Sensitivity</h2>
          <div className="segmented">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                className={
                  snapshot.settings.sensitivity === level ? "segment active" : "segment"
                }
                onClick={() => void updateSettings({ sensitivity: level })}
              >
                {level}
              </button>
            ))}
          </div>
          <p>{sensitivityCopy[snapshot.settings.sensitivity]}</p>
        </article>

        <article className="panel">
          <h2>Mask</h2>
          <div className="segmented">
            {(["pixelate", "blur", "solid"] as const).map((style) => (
              <button
                key={style}
                className={
                  snapshot.settings.maskStyle === style
                    ? "segment active"
                    : "segment"
                }
                onClick={() => void updateSettings({ maskStyle: style })}
              >
                {style}
              </button>
            ))}
          </div>
          <p>{maskStyleCopy[snapshot.settings.maskStyle]}</p>
        </article>

        <article className="panel">
          <h2>Startup</h2>
          <label className="toggle-row">
            <span>Launch on login</span>
            <input
              type="checkbox"
              checked={snapshot.settings.launchOnStartup}
              onChange={(event) =>
                void updateSettings({ launchOnStartup: event.target.checked })
              }
            />
          </label>
          <p>
            SafeScreen keeps all capture and inference on-device. No frame data is
            sent anywhere.
          </p>
        </article>

        <article className="panel wide">
          <h2>Blocked faces</h2>
          <div className="face-profile-form">
            <input
              type="text"
              value={faceProfileName}
              placeholder="Profile name"
              onChange={(event) => setFaceProfileName(event.target.value)}
            />
            <button
              className="secondary"
              disabled={!faceProfileName.trim()}
              onClick={() => void addFaceProfile()}
            >
              Add reference images
            </button>
          </div>
          {snapshot.settings.faceProfiles.length === 0 ? (
            <p>No blocked face profiles yet.</p>
          ) : (
            <div className="profile-list">
              {snapshot.settings.faceProfiles.map((profile) => (
                <div className="profile-row" key={profile.id}>
                  <div>
                    <strong>{profile.name}</strong>
                    <span>
                      {profile.imagePaths.length} reference image
                      {profile.imagePaths.length === 1 ? "" : "s"} -{" "}
                      {profile.status === "ready"
                        ? "ready"
                        : "face model pending"}
                    </span>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => void removeFaceProfile(profile.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel wide">
          <h2>Model status</h2>
          <p>{snapshot.modelInfo}</p>
          <div className="subtle">
            {isBooting
              ? "Connecting to the desktop runtime..."
              : "The app now uses a local NSFW classifier. On first run it may download model files into .cache/transformers, then reuse them locally."}
          </div>
        </article>
      </section>
    </main>
  );
}
