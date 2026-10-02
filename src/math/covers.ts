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
 * Whether a body at `(dx, dz)` from a cone's apex, past its angle, reaches `margin` to the nearer straight edge: a
 * segment from the apex out to the rim, inclusive, but for its outer corner, which lies on the exclusive rim.
 */
const reachesEdge = (shape: Cone, dx: number, dz: number, off: number, margin: number): boolean => {
  const heading = shape.dir + (off < 0 ? -shape.half : shape.half);
  const ux = Math.sin(heading);
  const uz = Math.cos(heading);
  const t = dx * ux + dz * uz;

  if (t >= shape.r) {
    return hypot(dx - shape.r * ux, dz - shape.r * uz) < margin;
  }

  const along = Math.max(0, t);

  return hypot(dx - along * ux, dz - along * uz) <= margin;
};

/**
 * Whether a body of radius `reach` at distance `d` and angle `off` inside a cone's angle (and short of its rim) lies
 * wholly inside it: `d · sin(half − |off|) >= reach` from the nearer edge's line, and `d >= reach` from the apex, the
 * nearest point left out once the body sits more than a right angle in from the edge (only an obtuse cone has such
 * points). A cone of half-angle π or more is the whole disc, with no edge to clear.
 */
const isWhollyInside = (shape: Cone, d: number, off: number, reach: number): boolean =>
  shape.half >= Math.PI || (d >= reach && Math.abs(off) <= shape.half - Math.asin(reach / d));

/**
 * Whether a body reaching `margin` past `p` overlaps a cone; near the apex it counts at any angle, the apex's radius
 * grown by the reach like any round rim (a body behind the tip still touches it). Past the cone's angle a body
 * reaching out is measured to the nearer edge, so one beyond an outer corner touches it only within its reach. A body
 * asked whether it lies wholly inside (a negative margin) must clear the edges and the apex.
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

  const off = wrap(Math.atan2(dx, dz) - shape.dir);

  if (Math.abs(off) <= shape.half) {
    return margin >= 0 || isWhollyInside(shape, d, off, -margin);
  }

  return margin > 0 && reachesEdge(shape, dx, dz, off, margin);
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

/**
 * Whether a body reaching `margin` past `p` overlaps a polygon grown by its band: signed edge distance within the
 * reach. A band rounds the corners into an exclusive rim, like a circle's; a bare polygon's edges are inclusive, like a
 * lane's, so polygons tiled flush leave no crack along their seam (a point on it is in both, the edge distance ±0).
 */
const coversPolygon = (shape: Polygon, p: Vec2, margin: number): boolean => {
  const edge = Math.sqrt(polygonEdgeDistanceSq(p, shape.points));
  const signed = inPolygon(p, shape.points) ? -edge : edge;
  const reach = shape.band + margin;

  return shape.band > 0 ? signed < reach : signed <= reach;
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
 *
 * The rims, the one place they are set out (a body of radius `R` reaches them `R` further out):
 * - point: reached at exactly the body's radius (`distance <= R`);
 * - circle: the rim is outside (`distance < r + R`);
 * - ring: the outer rim is outside, the inner rim inside, so rings sharing a radius tile the plane, no point in two;
 * - cone: the round rim and the apex circle's rim are outside, the straight edges inside (but for their outer corners,
 *   on the round rim); a cone of half-angle π or more is the whole disc;
 * - lane: every edge is inside, corners included, and a body reaching past one rounds it, inclusively;
 * - polygon: a bare (or shrunk) one's edges are inside, so polygons tiled flush leave no crack and share their seam;
 *   one grown by a band has a round rim, outside, like a circle's;
 * - outside: covers a body that is not wholly inside the shape, so its rims are the shape's, turned around;
 * - union and difference: their parts' rims, as the parts decide them.
 *
 * A body is tested exactly against base shapes, their unions and their outsides; against a difference, or the outside
 * of anything built, its centre and 36 points over its disc are (never a false hit, but a sliver narrower than their
 * spacing, about a third of the radius, can be missed). For an exact answer there, build the region the body's centre
 * may stand in (the shape grown by the body's radius) from base shapes, their unions and their outsides, and test the
 * bare point, which is never sampled: a body of radius `R` against `difference(circle(5), circle(2))` is exactly the
 * point against `ring(2 − R, 5 + R)`, and against the outside of two polygons tiled flush, the point against the
 * outside of their joined outline grown by `−R` (a polygon's band). A game that needs other rims wraps `covers` with
 * its own test. A point that is not finite (a NaN from upstream) is covered by nothing, `outside` shapes included.
 *
 * Cones, and lanes with a heading other than 0, go through `Math.sin`, `Math.cos` and `Math.atan2` (as do the 36
 * sample points, once, at load), which the spec leaves to each engine: a server and a mirror on different engines can
 * disagree in the last bit for a point on or against a rim. A game that wants rims exact between its peers authors
 * rotated shapes as polygons from its own tables of corners (circles, rings, polygons and unrotated lanes take only
 * `+ − × ÷` and `√`, correctly rounded everywhere).
 */
export const covers = (shape: Shape, p: Vec2, radius = 0): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.z) && coversBy(shape, p, radius);
