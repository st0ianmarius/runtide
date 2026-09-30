import { wrap } from './angles.ts';
import { inPolygon, polygonEdgeDistanceSq } from './polygon.ts';
import type { Cone, Lane, Polygon, Ring, Shape } from './shapes.ts';
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

  if (d < shape.apex + margin || d === 0) {
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

/** Whether a body reaching `margin` past `p` overlaps a polygon grown by its band: signed edge distance below the reach. */
const coversPolygon = (shape: Polygon, p: Vec2, margin: number): boolean => {
  const edge = Math.sqrt(polygonEdgeDistanceSq(p, shape.points));
  const signed = inPolygon(p, shape.points) ? -edge : edge;

  return signed < shape.band + margin;
};

/**
 * Whether a body reaching `margin` past `p` overlaps `shape`. A negative margin asks whether the whole body is inside,
 * which is how the complement and the cut of a difference are tested.
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
      return !coversBy(shape.shape, p, -margin);
    case 'union':
      return shape.shapes.some((part) => coversBy(part, p, margin));
    case 'difference':
      return coversBy(shape.base, p, margin) && !coversBy(shape.minus, p, -margin);
  }
};

/**
 * Whether `shape` covers a body of `radius` at `p` (0 for a bare point, the default): the body overlaps the shape.
 * Round outer rims (a circle's, a ring's and a cone's radius, a polygon's band) are exclusive and a ring's inner rim is
 * inclusive, so rings sharing a radius tile the plane with no point in two of them; a lane's and a cone's straight
 * edges are inclusive, and a point shape is reached at exactly the body's radius. An `outside` or `difference` covers
 * a body that is not wholly inside what it excludes. A game that needs other rims wraps `covers` with its own test.
 */
export const covers = (shape: Shape, p: Vec2, radius = 0): boolean => coversBy(shape, p, radius);
