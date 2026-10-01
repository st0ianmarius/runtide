// A body's move and a clearance test run per step, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import Flatbush from 'flatbush';

import {
  boundsOf,
  type Box,
  type Circle,
  covers,
  emptyBox,
  hypot,
  inPolygon,
  ORIGIN,
  pathIntervals,
  type Polygon,
  type TickPath,
  type Vec2
} from '../math/index.ts';

/** How far short of 0, relative to the lengths, a move's step out of a shape still counts as along it. */
const ALONG = 1e-9;

/**
 * How deep a body touching a shape may pass along it, relative to its radius (at least 1), and still slide on: a graze
 * at a seam between two shapes lying flush, a rounding past a corner, never a real entry.
 */
const GRAZE = 1e-6;

/** The nearest point a direction is measured from, and a step off an edge, reused. */
const NEAR = { x: 0, z: 0 };
const STEP = { x: 0, z: 0 };

/** A piece of static geometry: a wall, a pillar, a zone that never moves. */
export type StaticShape = Circle | Polygon;

/** Where a swept body first met static geometry: the share along the move, and which shape it met. */
interface Contact {
  share: number;
  index: number;
}

/**
 * The static geometry of a memory world in a packed R-tree (`flatbush`), built for its shapes and built again when
 * they change (a door opening, a wall raised): what bodies are swept against and lines of sight are tested through.
 * Contact follows `covers`, so a body touches a pillar when their edges overlap.
 */
export class StaticGeometry {
  #shapes: readonly StaticShape[] = [];
  #tree: Flatbush | undefined = undefined;
  readonly #box = emptyBox();
  readonly #times: number[] = [];
  readonly #contact: Contact = { share: 1, index: -1 };
  readonly #out = { x: 0, z: 0 };
  readonly #grazes: number[] = [];

  /** The path a contact asks `pathIntervals` about, written before each ask: no user code runs in between. */
  readonly #path = { from: ORIGIN, to: ORIGIN, t0: 0, t1: 1, radius: 0 };

  constructor(shapes: readonly StaticShape[]) {
    this.set(shapes);
  }

  /** Puts in new shapes in place of the old, building the tree again. */
  set(shapes: readonly StaticShape[]): void {
    this.#shapes = shapes;

    if (shapes.length === 0) {
      this.#tree = undefined;

      return;
    }

    const tree = new Flatbush(shapes.length);

    for (const shape of shapes) {
      const box = boundsOf(shape, 0, this.#box);

      tree.add(box.minX, box.minZ, box.maxX, box.maxZ);
    }

    tree.finish();
    this.#tree = tree;
  }

  /** Whether a body of `radius` at `p` overlaps no static shape. */
  isClear(p: Vec2, radius: number): boolean {
    const tree = this.#tree;

    if (tree === undefined) {
      return true;
    }

    const hits = tree.search(p.x - radius, p.z - radius, p.x + radius, p.z + radius);

    for (let i = 0; i < hits.length; i++) {
      const shape = this.#shapes[hits[i] ?? -1];

      if (shape !== undefined && covers(shape, p, radius)) {
        return false;
      }
    }

    return true;
  }

  /**
   * The earliest share along `from → to` at which a body of `radius` touches a static shape, or `undefined` when it
   * touches none. A body that starts overlapping a shape and moves away from it is let go (a knocked body leaving a
   * wall); one that moves further in stops at once (share 0). The shape met is noted for `normalOf`.
   */
  contact(from: Vec2, to: Vec2, radius: number): number | undefined {
    const tree = this.#tree;
    const found = this.#contact;

    found.share = 1;
    found.index = -1;

    if (tree === undefined) {
      return undefined;
    }

    const box = this.#sweptBox(from, to, radius);
    const hits = tree.search(box.minX, box.minZ, box.maxX, box.maxZ);

    for (let i = 0; i < hits.length; i++) {
      const index = hits[i] ?? -1;
      const share = this.#shareOf(index, from, to, radius);

      if (share !== undefined && (found.index < 0 || share < found.share)) {
        found.share = share;
        found.index = index;
      }
    }

    return found.index < 0 ? undefined : found.share;
  }

  /**
   * The unit normal of the last contact's shape at `p` (a body's centre where it stopped), pointing from the shape
   * toward the body, into `out`; `undefined` when the last sweep met nothing.
   */
  normalOf(p: Vec2, out: { x: number; z: number }): Vec2 | undefined {
    const shape = this.#shapes[this.#contact.index];

    if (shape === undefined) {
      return undefined;
    }

    return outwardAt(shape, p, out);
  }

  /**
   * When a body first touches one shape along the move, or `undefined`: a body starting inside a shape and heading
   * out is let go until it touches the shape again, if it does.
   */
  #shareOf(index: number, from: Vec2, to: Vec2, radius: number): number | undefined {
    const shape = this.#shapes[index];
    const count = shape === undefined ? 0 : pathIntervals(shape, this.#pathOf(from, to, radius), this.#times);

    if (shape === undefined || count === 0) {
      return undefined;
    }

    const share = this.#times[0] ?? 1;

    if (share > 0 || !(this.#isLeaving(shape, from, to) || this.#isGrazing(shape, from, to, radius))) {
      return share;
    }

    return count > 1 ? this.#times[2] : undefined;
  }

  /** Whether a body touching a shape only grazes it along the move: a body a hair smaller would not touch it at all. */
  #isGrazing(shape: StaticShape, from: Vec2, to: Vec2, radius: number): boolean {
    const smaller = radius - GRAZE * Math.max(1, radius);

    return smaller > 0 && pathIntervals(shape, this.#pathOf(from, to, smaller), this.#grazes) === 0;
  }

  /** The tick-long path of a body of `radius` from `from` to `to`, in the reused record. */
  #pathOf(from: Vec2, to: Vec2, radius: number): TickPath {
    const path = this.#path;

    path.from = from;
    path.to = to;
    path.radius = radius;

    return path;
  }

  /**
   * Whether a move from touching a shape heads away from it or along it: its step along the way out from the shape's
   * nearest point, a rounding short of 0 counting as along (a slide on the normal `moveBody` returned).
   */
  #isLeaving(shape: StaticShape, from: Vec2, to: Vec2): boolean {
    const out = outwardAt(shape, from, this.#out);
    const dx = to.x - from.x;
    const dz = to.z - from.z;

    return dx * out.x + dz * out.z > -ALONG * hypot(dx, dz);
  }

  /** The box a body of `radius` sweeps along a segment. */
  #sweptBox(from: Vec2, to: Vec2, radius: number): Box {
    const box = this.#box;

    box.minX = Math.min(from.x, to.x) - radius;
    box.minZ = Math.min(from.z, to.z) - radius;
    box.maxX = Math.max(from.x, to.x) + radius;
    box.maxZ = Math.max(from.z, to.z) + radius;

    return box;
  }
}

/**
 * The unit direction out of a shape at `p`, into `out`: from its nearest point toward `p` (away from it for a point
 * inside a polygon), or, for `p` on a polygon's edge, that edge's outward normal; none (0, 0) at a circle's centre.
 */
const outwardAt = (shape: StaticShape, p: Vec2, out: { x: number; z: number }): Vec2 => {
  const near = shape.kind === 'circle' ? shape.at : nearestOnEdges(p, shape.points, NEAR);
  const sign = shape.kind === 'polygon' && inPolygon(p, shape.points) ? -1 : 1;
  const dx = (p.x - near.x) * sign;
  const dz = (p.z - near.z) * sign;
  const length = hypot(dx, dz);

  if (length > 1e-12 || shape.kind === 'circle') {
    out.x = length > 1e-12 ? dx / length : 0;
    out.z = length > 1e-12 ? dz / length : 0;

    return out;
  }

  return edgeNormal(p, shape.points, out);
};

/** The outward unit normal of the polygon edge nearest `p` (a point on it), into `out`. */
const edgeNormal = (p: Vec2, points: readonly Vec2[], out: { x: number; z: number }): Vec2 => {
  let best = Number.POSITIVE_INFINITY;
  let a = points.at(-1);

  out.x = 0;
  out.z = 0;

  for (let i = 0; i < points.length; i++) {
    const b = points[i];
    const d = a === undefined || b === undefined ? Number.POSITIVE_INFINITY : edgeDistance(p, a, b);

    if (a !== undefined && b !== undefined && d < best) {
      const length = hypot(b.x - a.x, b.z - a.z);

      best = d;
      out.x = (b.z - a.z) / length;
      out.z = -(b.x - a.x) / length;
    }

    a = b;
  }

  // Either side of an edge is its outward one: the side a step from `p` does not land inside the polygon.
  STEP.x = p.x + out.x * 1e-6;
  STEP.z = p.z + out.z * 1e-6;

  if (inPolygon(STEP, points)) {
    out.x = -out.x;
    out.z = -out.z;
  }

  return out;
};

/** The squared distance from `p` to the segment `a`–`b`. */
const edgeDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;

  return (a.x + dx * t - p.x) ** 2 + (a.z + dz * t - p.z) ** 2;
};

/** The point of a closed polygon's edges nearest `p`, into `out`. */
const nearestOnEdges = (p: Vec2, points: readonly Vec2[], out: { x: number; z: number }): Vec2 => {
  let best = Number.POSITIVE_INFINITY;
  let a = points.at(-1);

  for (let i = 0; i < points.length; i++) {
    const b = points[i];

    if (a !== undefined && b !== undefined) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;

      const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2)) : 0;

      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;

      if (d < best) {
        best = d;
        out.x = x;
        out.z = z;
      }
    }

    a = b;
  }

  return out;
};
