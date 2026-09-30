// Hot path: a catch tests every unit against a polygon, so its loops are indexed (an iterator
// allocates).
/* oxlint-disable typescript/prefer-for-of */
import type { Vec2 } from './vec2.ts';

/** Whether `p` is inside a polygon, by the even-odd rule; a point exactly on an edge may fall either way. */
export const inPolygon = (p: Vec2, points: readonly Vec2[]): boolean => {
  let inside = false;
  let b = points.at(-1);

  for (let i = 0; i < points.length; i++) {
    const a = points[i];

    if (
      a !== undefined &&
      b !== undefined &&
      a.z > p.z !== b.z > p.z &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }

    b = a;
  }

  return inside;
};

/** The squared distance from `p` to the segment `a → b` (to `a` for a zero-length segment). */
export const segmentDistanceSq = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;

  const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;

  const ex = a.x + dx * t - p.x;
  const ez = a.z + dz * t - p.z;

  return ex * ex + ez * ez;
};

/** The squared distance from `p` to the nearest edge of a closed polygon. */
export const polygonEdgeDistanceSq = (p: Vec2, points: readonly Vec2[]): number => {
  let best = Number.POSITIVE_INFINITY;
  let a = points.at(-1);

  for (let i = 0; i < points.length; i++) {
    const b = points[i];

    if (a !== undefined && b !== undefined) {
      best = Math.min(best, segmentDistanceSq(p, a, b));
    }

    a = b;
  }

  return best;
};
