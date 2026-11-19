import { useRuntimeSnapshot } from "../hooks/use-runtime-snapshot";

export function OverlayView() {
  const { snapshot } = useRuntimeSnapshot();

  if (!snapshot.settings.enabled) {
    return <div className="overlay-root" />;
  }

  return (
    <div className="overlay-root">
      {snapshot.masks.map((mask) => (
        <div
          key={mask.trackingId}
          className={`overlay-mask overlay-mask-${mask.style}`}
          style={{
            left: `${mask.box.x}px`,
            top: `${mask.box.y}px`,
            width: `${mask.box.width}px`,
            height: `${mask.box.height}px`,
            opacity: mask.opacity
          }}
        />
      ))}
    </div>
  );
}
