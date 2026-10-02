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

/**
 * Where the segment `a → b` crosses the segment `c → d`, ends included, or `undefined` when they do not cross.
 * Parallel and collinear segments (the cross product of their directions below `1e-12`) never cross, so a path
 * doubling back along itself closes no loop.
 */
export const segmentIntersection = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | undefined => {
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

  return { x: a.x + rx * t, z: a.z + rz * t };
};

/** Twice a polygon's signed area by the shoelace formula: positive when its corners turn as `cross` turns. */
const twiceSignedArea = (points: readonly Vec2[]): number => {
  let twice = 0;
  let a = points.at(-1);

  for (let i = 0; i < points.length; i++) {
    const b = points[i];

    if (a !== undefined && b !== undefined) {
      twice += a.x * b.z - b.x * a.z;
    }

    a = b;
  }

  return twice;
};

/**
 * The area of a simple polygon, unsigned, so either winding gives the same (as `Polygon` takes either); 0 for fewer
 * than three corners. A self-crossing outline gives its lobes' areas netted by their windings.
 */
export const polygonArea = (points: readonly Vec2[]): number => Math.abs(twiceSignedArea(points)) / 2;

/** Below this twice-area (in square units) a polygon has no area to weigh, and its centroid is its corners' mean. */
const NO_AREA = 1e-9;

/** The mean of some points; the origin for none. */
const meanOf = (points: readonly Vec2[]): Vec2 => {
  let x = 0;
  let z = 0;

  for (let i = 0; i < points.length; i++) {
    x += points[i]?.x ?? 0;
    z += points[i]?.z ?? 0;
  }

  const count = Math.max(1, points.length);

  return { x: x / count, z: z / count };
};

/**
 * The centroid of a simple polygon's area, either winding; for one with (next to) no area, a twice-area below `1e-9`
 * (a line, a point, nothing), the mean of its corners, the origin for none.
 */
export const polygonCentroid = (points: readonly Vec2[]): Vec2 => {
  const twice = twiceSignedArea(points);

  if (Math.abs(twice) < NO_AREA) {
    return meanOf(points);
  }

  let cx = 0;
  let cz = 0;
  let a = points.at(-1);

  for (let i = 0; i < points.length; i++) {
    const b = points[i];

    if (a !== undefined && b !== undefined) {
      const cross = a.x * b.z - b.x * a.z;

      cx += (a.x + b.x) * cross;
      cz += (a.z + b.z) * cross;
    }

    a = b;
  }

  return { x: cx / (3 * twice), z: cz / (3 * twice) };
};
