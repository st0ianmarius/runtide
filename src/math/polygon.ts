// Hot path (§I.4.2, §I.5.4): a catch tests every unit against a polygon, so its loops are indexed (an iterator
// allocates).
/* oxlint-disable typescript/prefer-for-of */
import type { Vec2 } from './vec2.ts';

/** Where two segments cross: the share along each, and the point. */
export interface Crossing {
  /** The share along the first segment, in `[0, 1]`. */
  readonly t: number;

  /** The share along the second segment, in `[0, 1]`. */
  readonly u: number;

  /** The crossing point. */
  readonly point: Vec2;
}

/**
 * Where segment `a → b` crosses segment `c → d`, or `undefined`. Parallel and collinear segments never cross, so a
 * path doubling back along itself closes no loop.
 */
export const segmentIntersection = (a: Vec2, b: Vec2, [c, d]: readonly [Vec2, Vec2]): Crossing | undefined => {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const denominator = rx * sz - rz * sx;

  if (Math.abs(denominator) < 1e-12) {
    return undefined;
  }

  const qx = c.x - a.x;
  const qz = c.z - a.z;
  const t = (qx * sz - qz * sx) / denominator;
  const u = (qx * rz - qz * rx) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return undefined;
  }

  return { t, u, point: { x: a.x + rx * t, z: a.z + rz * t } };
};

/** Twice the signed area of a polygon by the shoelace formula (positive when counter-clockwise in x-z). */
const twiceSignedArea = (points: readonly Vec2[]): number => {
  let twice = 0;
  let previous = points.at(-1);

  for (const current of points) {
    if (previous !== undefined) {
      twice += previous.x * current.z - current.x * previous.z;
    }

    previous = current;
  }

  return twice;
};

/** The unsigned area of a simple polygon; the winding does not matter. */
export const polygonArea = (points: readonly Vec2[]): number => Math.abs(twiceSignedArea(points)) / 2;

/** The area centroid of a simple polygon; the mean of its corners when it has no area. */
export const polygonCentroid = (points: readonly Vec2[]): Vec2 => {
  const twice = twiceSignedArea(points);
  let cx = 0;
  let cz = 0;
  let previous = points.at(-1);

  for (const current of points) {
    if (previous !== undefined) {
      const crossed = previous.x * current.z - current.x * previous.z;

      cx += (previous.x + current.x) * crossed;
      cz += (previous.z + current.z) * crossed;
    }

    previous = current;
  }

  if (Math.abs(twice) < 1e-9) {
    const n = Math.max(1, points.length);

    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / n,
      z: points.reduce((sum, p) => sum + p.z, 0) / n,
    };
  }

  return { x: cx / (3 * twice), z: cz / (3 * twice) };
};

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
