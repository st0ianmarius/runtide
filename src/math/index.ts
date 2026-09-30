/**
 * Geometry on the ground plane: `Vec2`, angles, shapes as data with `covers`, shape algebra, bounds, the
 * segment-circle sweep, the swept path tests and polygon tests. Nothing here reads a world; the world
 * query builds on it.
 */

export { angleDelta, directionOf, headingOf, turnToward, wrap } from './angles.ts';
export { boundsOf, type Box, emptyBox, type MutableBox } from './bounds.ts';
export { covers } from './covers.ts';

export {
  type ExposureOptions,
  type PathCrossing,
  pathCrossings,
  pathIntervals,
  secondsInside,
  type ShapeAt,
  type TickPath,
  type TimeWindow,
} from './path.ts';

export { inPolygon, polygonEdgeDistanceSq, segmentDistanceSq } from './polygon.ts';

export {
  type Circle,
  circle,
  type Cone,
  cone,
  type ConeSpec,
  type Difference,
  difference,
  type Lane,
  lane,
  type LaneSpec,
  type Outside,
  outside,
  point,
  type PointShape,
  type Polygon,
  polygon,
  type Ring,
  ring,
  type Shape,
  type Union,
  union,
} from './shapes.ts';

export { sweepCircle } from './sweep.ts';

export {
  addVec,
  cross,
  distance,
  distanceSq,
  dot,
  hypot,
  lengthOf,
  lengthSq,
  lerp,
  type MutableVec2,
  normalize,
  ORIGIN,
  scale,
  sub,
  type Vec2,
  vec2,
} from './vec2.ts';
