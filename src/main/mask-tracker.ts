import type { DetectionHit, MaskStyle, OverlayMask } from "../shared/contracts.js";

type TrackedMask = OverlayMask & {
  ttl: number;
};

const MAX_TTL = 3;
const DISTANCE_THRESHOLD = 120;

function center(box: OverlayMask["box"] | DetectionHit["box"]) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function distance(
  a: OverlayMask["box"] | DetectionHit["box"],
  b: OverlayMask["box"] | DetectionHit["box"]
) {
  const pointA = center(a);
  const pointB = center(b);
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function smoothBox(
  previous: OverlayMask["box"],
  next: DetectionHit["box"]
): OverlayMask["box"] {
  const alpha = 0.4;
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
    width: previous.width + (next.width - previous.width) * alpha,
    height: previous.height + (next.height - previous.height) * alpha
  };
}

export class MaskTracker {
  private masks = new Map<string, TrackedMask>();
  private nextId = 0;

  update(hits: DetectionHit[], style: MaskStyle): OverlayMask[] {
    const nextMasks = new Map<string, TrackedMask>();
    const previousMasks = Array.from(this.masks.values());
    const remaining = new Set(previousMasks.map((mask) => mask.trackingId));
    const sortedHits = [...hits].sort((a, b) => b.confidence - a.confidence);

    for (const hit of sortedHits) {
      let match: TrackedMask | undefined;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const candidate of previousMasks) {
        if (!remaining.has(candidate.trackingId)) {
          continue;
        }

        const candidateDistance = distance(candidate.box, hit.box);
        if (
          candidateDistance <= DISTANCE_THRESHOLD &&
          candidateDistance < closestDistance
        ) {
          match = candidate;
          closestDistance = candidateDistance;
        }
      }

      if (match) {
        remaining.delete(match.trackingId);
        nextMasks.set(match.trackingId, {
          ...match,
          box: smoothBox(match.box, hit.box),
          style,
          opacity: Math.max(0.45, Math.min(0.9, hit.confidence)),
          ttl: MAX_TTL
        });
      } else {
        const trackingId = `mask-${this.nextId++}`;
        nextMasks.set(trackingId, {
          trackingId,
          box: { ...hit.box },
          style,
          opacity: Math.max(0.45, Math.min(0.9, hit.confidence)),
          ttl: MAX_TTL
        });
      }
    }

    for (const trackingId of remaining) {
      const previous = this.masks.get(trackingId);
      if (!previous) {
        continue;
      }

      const ttl = previous.ttl - 1;
      if (ttl > 0) {
        nextMasks.set(trackingId, {
          ...previous,
          ttl,
          opacity: Math.max(0.2, previous.opacity - 0.12)
        });
      }
    }

    this.masks = nextMasks;
    return Array.from(nextMasks.values());
  }

  clear(): OverlayMask[] {
    this.masks.clear();
    return [];
  }
}
