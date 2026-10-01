import { wrap } from './angles.ts';
import { inPolygon, polygonEdgeDistanceSq } from './polygon.ts';
import type { Cone, Difference, Lane, Outside, Polygon, Ring, Shape, Union } from './shapes.ts';
import { hypot, type Vec2 } from './vec2.ts';

/**
 * Whether a body reaching `margin` past `p` overlaps a ring. Both rims are tested as distances against the radii the
 * path tests solve for (`outer + margin`, `inner - margin`), so the two round alike: `d + margin >= inner` could round
 * up to the rim for a body just short of it.
 */
const coversRing = (shape: Ring, p: Vec2, margin: number): boolean => {
  const d = hypot(p.x - shape.at.x, p.z - shape.at.z);

  return d < shape.outer + margin && d >= shape.inner - margin;
};

/**
 * Whether a body reaching `margin` past `p` overlaps a cone; near the apex it counts at any angle, the apex's radius
 * grown by the reach like any round rim (a body behind the tip still touches it).
 */
const coversCone = (shape: Cone, p: Vec2, margin: number): boolean => {
  const dx = p.x - shape.at.x;
  const dz = p.z - shape.at.z;
  const d = hypot(dx, dz);

  if (d >= shape.r + margin) {
    return false;
  }

  // At the apex every direction is the cone's own, but only for a body reaching out: one asked whether it lies wholly
  // inside (a negative margin, for an `outside`) is not, as the cone spans less than every direction.
  if (d < shape.apex + margin || (d === 0 && margin >= 0)) {
    return true;
  }

  const allowance = margin === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, margin / d)));

  return Math.abs(wrap(Math.atan2(dx, dz) - shape.dir)) <= shape.half + allowance;
};

/** Whether a body reaching `margin` past `p` overlaps a lane. */
const coversLane = (shape: Lane, p: Vec2, margin: number): boolean => {
  const dx = p.x - shape.at.x;
  const dz = p.z - shape.at.z;
  const sin = Math.sin(shape.dir);
  const cos = Math.cos(shape.dir);
  const along = dx * sin + dz * cos;
  const across = dx * cos - dz * sin;
  const half = shape.width / 2;

  // A negative margin (a complement's) shrinks the rectangle, which stays one.
  if (margin <= 0) {
    return along >= -shape.back - margin && along <= shape.length + margin && Math.abs(across) <= half + margin;
  }

  // The gap from the body's centre to the rectangle: a disc overlaps it at rounded corners, not square ones.
  const outAlong = along < -shape.back ? -shape.back - along : Math.max(0, along - shape.length);
  const outAcross = Math.max(0, Math.abs(across) - half);

  return outAlong * outAlong + outAcross * outAcross <= margin * margin;
};

/** Whether a body reaching `margin` past `p` overlaps any of some shapes (a union's parts), with no closure made. */
const coversAny = (shapes: readonly Shape[], p: Vec2, margin: number): boolean => {
  for (const part of shapes) {
    if (coversBy(part, p, margin)) {
      return true;
    }
  }

  return false;
};

/** Whether a body reaching `margin` past `p` overlaps a polygon grown by its band: signed edge distance below the reach. */
const coversPolygon = (shape: Polygon, p: Vec2, margin: number): boolean => {
  const edge = Math.sqrt(polygonEdgeDistanceSq(p, shape.points));
  const signed = inPolygon(p, shape.points) ? -edge : edge;

  return signed < shape.band + margin;
};

/** The rings of points a body is sampled at, past its centre: the `k`th at `k / SAMPLE_RINGS` of its reach. */
const SAMPLE_RINGS = 3;

/** The points a body is sampled at, as offsets in units of its reach: its centre, then `6k` points on ring `k`. */
export const SAMPLES = (() => {
  const xs = [0];
  const zs = [0];

  for (let k = 1; k <= SAMPLE_RINGS; k++) {
    const count = 6 * k;

    // Each ring turned half a step from the last, so its points fall between the ones inside it.
    for (let j = 0; j < count; j++) {
      const angle = ((j + (k % 2) / 2) / count) * 2 * Math.PI;

      xs.push((Math.sin(angle) * k) / SAMPLE_RINGS);
      zs.push((Math.cos(angle) * k) / SAMPLE_RINGS);
    }
  }

  return { xs: Float64Array.from(xs), zs: Float64Array.from(zs) };
})();

/** The sample point `coversSampled` moves over a body; only bare-point tests read it, so it is never nested. */
const sample = { x: 0, z: 0 };

/**
 * Whether any sampled point of a body reaching `margin` past `p` lies in `shape`, tested as a bare point. Every sample
 * is a real point of the body, so a hit is never false, though a sliver thinner than the samples' spacing goes unseen.
 */
const coversSampled = (shape: Shape, p: Vec2, margin: number): boolean => {
  const { xs, zs } = SAMPLES;

  for (let i = 0; i < xs.length; i++) {
    sample.x = p.x + (xs[i] ?? 0) * margin;
    sample.z = p.z + (zs[i] ?? 0) * margin;

    if (coversBy(shape, sample, 0)) {
      return true;
    }
  }

  return false;
};

/** Whether a shape is a base shape, one no algebra builds. */
const isBase = (shape: Shape): boolean =>
  shape.kind !== 'outside' && shape.kind !== 'union' && shape.kind !== 'difference';

/**
 * Whether a body reaching `margin` past `p` overlaps `shape`. A negative margin asks whether the whole body is inside a
 * base shape, which is how the complement of one is tested. Growing each part of the algebra by the body does not
 * keep its geometry past a union (a body inside two touching parts is inside neither) or into a difference (a body
 * may touch the base only where the cut covers it), so a body reaching into those is sampled instead.
 */
const coversBy = (shape: Shape, p: Vec2, margin: number): boolean => {
  switch (shape.kind) {
    case 'point':
      return hypot(p.x - shape.at.x, p.z - shape.at.z) <= margin;
    case 'circle':
      return hypot(p.x - shape.at.x, p.z - shape.at.z) < shape.r + margin;
    case 'ring':
      return coversRing(shape, p, margin);
    case 'cone':
      return coversCone(shape, p, margin);
    case 'lane':
      return coversLane(shape, p, margin);
    case 'polygon':
      return coversPolygon(shape, p, margin);
    case 'outside':
    case 'union':
    case 'difference':
      return coversBuilt(shape, p, margin);
  }
};

/** Whether a body reaching `margin` into a shape the algebra built is sampled; `PathCandidates` asks the same. */
export const isSampled = (shape: Outside | Difference, margin: number): boolean =>
  margin > 0 && (shape.kind === 'difference' || !isBase(shape.shape));

/** Whether a body reaching `margin` past `p` overlaps a shape the algebra built: exactly where it can, else sampled. */
const coversBuilt = (shape: Outside | Union | Difference, p: Vec2, margin: number): boolean => {
  if (shape.kind === 'union') {
    return coversAny(shape.shapes, p, margin);
  }

  if (isSampled(shape, margin)) {
    return coversSampled(shape, p, margin);
  }

  return shape.kind === 'outside'
    ? !coversBy(shape.shape, p, -margin)
    : coversBy(shape.base, p, 0) && !coversBy(shape.minus, p, 0);
};

/**
 * Whether `shape` covers a body of `radius` at `p` (0 for a bare point, the default): the body overlaps the shape.
 * Round outer rims (a circle's, a ring's and a cone's radius, a polygon's band) are exclusive and a ring's inner rim is
 * inclusive, so rings sharing a radius tile the plane with no point in two of them; a lane's and a cone's straight
 * edges are inclusive, and a point shape is reached at exactly the body's radius. An `outside` or `difference` covers
 * a body that is not wholly inside what it excludes. A body is tested exactly against base shapes, their unions and
 * their outsides; against a difference, or the outside of anything built, its centre and 36 points over its disc are
 * (never a false hit, but a sliver narrower than their spacing, about a third of the radius, can be missed). A game that
 * needs other rims wraps `covers` with its own test. A point that is not finite (a NaN from upstream) is covered by
 * nothing, `outside` shapes included.
 */
export const covers = (shape: Shape, p: Vec2, radius = 0): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.z) && coversBy(shape, p, radius);
