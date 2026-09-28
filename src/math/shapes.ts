import { ORIGIN, type Vec2 } from './vec2.ts';

/** A point: covered by a body that reaches it. */
export interface PointShape {
  /** The discriminant. */
  readonly kind: 'point';

  /** Where the point is. */
  readonly at: Vec2;
}

/** A disc of radius `r`. */
export interface Circle {
  /** The discriminant. */
  readonly kind: 'circle';

  /** The centre. */
  readonly at: Vec2;

  /** The radius; the rim itself is outside. */
  readonly r: number;
}

/** The band between two radii. */
export interface Ring {
  /** The discriminant. */
  readonly kind: 'ring';

  /** The centre. */
  readonly at: Vec2;

  /** The inner radius; the inner rim itself is inside. */
  readonly inner: number;

  /** The outer radius; the outer rim itself is outside. */
  readonly outer: number;
}

/** A sector of a disc, opening `half` radians to each side of the heading `dir`. */
export interface Cone {
  /** The discriminant. */
  readonly kind: 'cone';

  /** The apex. */
  readonly at: Vec2;

  /** The radius; the rim itself is outside. */
  readonly r: number;

  /** The half-angle in radians. */
  readonly half: number;

  /** The heading it faces, as `atan2(x, z)`. */
  readonly dir: number;

  /** A radius around the apex that counts as inside at any angle (0 for none). */
  readonly apex: number;
}

/** A rectangle that starts at `at` and runs `length` along the heading `dir`, `width` wide. */
export interface Lane {
  /** The discriminant. */
  readonly kind: 'lane';

  /** Where the lane starts, on its centre line. */
  readonly at: Vec2;

  /** How far it runs along its heading. */
  readonly length: number;

  /** Its full width across. */
  readonly width: number;

  /** The heading it runs along, as `atan2(x, z)`. */
  readonly dir: number;

  /** How far it also reaches behind its start (0 for none). */
  readonly back: number;
}

/** A simple polygon, grown by `band` on every side (0 for the polygon itself). */
export interface Polygon {
  /** The discriminant. */
  readonly kind: 'polygon';

  /** The corners in order, either winding; the last joins the first. */
  readonly points: readonly Vec2[];

  /** How far the covered area reaches past the edges. */
  readonly band: number;
}

/** Everything a shape does not cover. */
export interface Outside {
  /** The discriminant. */
  readonly kind: 'outside';

  /** The shape whose complement this is. */
  readonly shape: Shape;
}

/** Everything any of several shapes covers. */
export interface Union {
  /** The discriminant. */
  readonly kind: 'union';

  /** The shapes joined. */
  readonly shapes: readonly Shape[];
}

/** What one shape covers and another does not. */
export interface Difference {
  /** The discriminant. */
  readonly kind: 'difference';

  /** The shape cut from. */
  readonly base: Shape;

  /** The shape cut away. */
  readonly minus: Shape;
}

/** Every shape: plain data, told apart by `kind`. */
export type Shape = PointShape | Circle | Ring | Cone | Lane | Polygon | Outside | Union | Difference;

/** The tunables of a cone beyond its radius. */
export interface ConeSpec {
  /** The radius. */
  readonly r: number;

  /** The half-angle in radians. */
  readonly half: number;

  /** The heading it faces. */
  readonly dir: number;

  /** The apex; the origin by default. */
  readonly at?: Vec2;

  /** The radius around the apex that counts at any angle; 0 by default. */
  readonly apex?: number;
}

/** The tunables of a lane. */
export interface LaneSpec {
  /** How far it runs. */
  readonly length: number;

  /** Its full width. */
  readonly width: number;

  /** The heading it runs along. */
  readonly dir: number;

  /** Where it starts; the origin by default. */
  readonly at?: Vec2;

  /** How far it also reaches behind its start; 0 by default. */
  readonly back?: number;
}

/** A point shape. */
export const point = (at: Vec2): PointShape => ({ kind: 'point', at });

/** A disc of radius `r` centred on `at` (the origin by default). */
export const circle = (r: number, at: Vec2 = ORIGIN): Circle => ({ kind: 'circle', at, r });

/** A ring between `inner` and `outer` centred on `at` (the origin by default). */
export const ring = (inner: number, outer: number, at: Vec2 = ORIGIN): Ring => ({ kind: 'ring', at, inner, outer });

/** A cone. */
export const cone = (spec: ConeSpec): Cone => ({
  kind: 'cone',
  at: spec.at ?? ORIGIN,
  r: spec.r,
  half: spec.half,
  dir: spec.dir,
  apex: spec.apex ?? 0,
});

/** A lane. */
export const lane = (spec: LaneSpec): Lane => ({
  kind: 'lane',
  at: spec.at ?? ORIGIN,
  length: spec.length,
  width: spec.width,
  dir: spec.dir,
  back: spec.back ?? 0,
});

/** A polygon over `points`, grown by `band` (0 by default). */
export const polygon = (points: readonly Vec2[], band = 0): Polygon => ({ kind: 'polygon', points, band });

/** The complement of a shape (the burn outside a ring of fire). */
export const outside = (shape: Shape): Outside => ({ kind: 'outside', shape });

/** The union of shapes. */
export const union = (...shapes: readonly Shape[]): Union => ({ kind: 'union', shapes });

/** What `base` covers and `minus` does not (a lane with a gap). */
export const difference = (base: Shape, minus: Shape): Difference => ({ kind: 'difference', base, minus });
