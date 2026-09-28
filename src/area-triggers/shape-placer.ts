import { ORIGIN, point, type Shape, type Vec2 } from '../math/index.ts';

/** A point at the origin: what a placer holds before its first template. */
const ORIGIN_POINT = Object.freeze(point(ORIGIN));

/** A point a placer writes. */
interface Point {
  x: number;
  z: number;
}

/** Where and which way a shape is placed. */
interface Pose {
  /** The x it is placed at. */
  x: number;

  /** The z it is placed at. */
  z: number;

  /** The heading's sine. */
  sin: number;

  /** The heading's cosine. */
  cos: number;

  /** The heading. */
  heading: number;
}

/** A placed shape a placer rewrites in place: the same kinds as `Shape`, writable, each holding its template. */
type Placed =
  | { readonly kind: 'point'; readonly at: Point; readonly template: Extract<Shape, { kind: 'point' }> }
  | { readonly kind: 'circle'; readonly at: Point; r: number; readonly template: Extract<Shape, { kind: 'circle' }> }
  | {
      readonly kind: 'ring';
      readonly at: Point;
      inner: number;
      outer: number;
      readonly template: Extract<Shape, { kind: 'ring' }>;
    }
  | {
      readonly kind: 'cone';
      readonly at: Point;
      r: number;
      half: number;
      dir: number;
      apex: number;
      readonly template: Extract<Shape, { kind: 'cone' }>;
    }
  | {
      readonly kind: 'lane';
      readonly at: Point;
      length: number;
      width: number;
      dir: number;
      back: number;
      readonly template: Extract<Shape, { kind: 'lane' }>;
    }
  | {
      readonly kind: 'polygon';
      readonly points: Point[];
      band: number;
      readonly template: Extract<Shape, { kind: 'polygon' }>;
    }
  | { readonly kind: 'outside'; readonly shape: Placed }
  | { readonly kind: 'union'; readonly shapes: Placed[] }
  | { readonly kind: 'difference'; readonly base: Placed; readonly minus: Placed };

/** Moves a local point into the world: its x across the heading, its z along it. */
const transform = (out: Point, local: Vec2, pose: Pose): void => {
  out.x = pose.x + local.x * pose.cos + local.z * pose.sin;
  out.z = pose.z - local.x * pose.sin + local.z * pose.cos;
};

/** A placed shape with the same structure as a template, holding it (its numbers written by `write`). */
const mirror = (template: Shape): Placed => {
  const at = { x: 0, z: 0 };

  switch (template.kind) {
    case 'point':
      return { kind: 'point', at, template };
    case 'circle':
      return { kind: 'circle', at, r: 0, template };
    case 'ring':
      return { kind: 'ring', at, inner: 0, outer: 0, template };
    case 'cone':
      return { kind: 'cone', at, r: 0, half: 0, dir: 0, apex: 0, template };
    case 'lane':
      return { kind: 'lane', at, length: 0, width: 0, dir: 0, back: 0, template };
    case 'polygon':
      return { kind: 'polygon', points: template.points.map(() => ({ x: 0, z: 0 })), band: 0, template };
    case 'outside':
      return { kind: 'outside', shape: mirror(template.shape) };
    case 'union':
      return { kind: 'union', shapes: template.shapes.map(mirror) };
    case 'difference':
      return { kind: 'difference', base: mirror(template.base), minus: mirror(template.minus) };
  }
};

/** Writes a polygon's corners, turned and placed. */
const writePolygon = (placed: Extract<Placed, { kind: 'polygon' }>, pose: Pose): void => {
  const { template } = placed;

  for (let i = 0; i < placed.points.length; i++) {
    const out = placed.points[i];
    const local = template.points[i];

    if (out !== undefined && local !== undefined) {
      transform(out, local, pose);
    }
  }

  placed.band = template.band;
};

/** Writes a cone's or a lane's numbers: its apex or start placed, its heading turned. */
const writeHeaded = (placed: Extract<Placed, { kind: 'cone' | 'lane' }>, pose: Pose): void => {
  transform(placed.at, placed.template.at, pose);

  if (placed.kind === 'cone') {
    const { template } = placed;

    placed.r = template.r;
    placed.half = template.half;
    placed.dir = template.dir + pose.heading;
    placed.apex = template.apex;

    return;
  }

  const { template } = placed;

  placed.length = template.length;
  placed.width = template.width;
  placed.dir = template.dir + pose.heading;
  placed.back = template.back;
};

/** Writes a placed shape's numbers from the template it holds, placed at the pose. */
const write = (placed: Placed, pose: Pose): void => {
  switch (placed.kind) {
    case 'point':
      transform(placed.at, placed.template.at, pose);
      break;
    case 'circle':
      transform(placed.at, placed.template.at, pose);
      placed.r = placed.template.r;
      break;
    case 'ring':
      transform(placed.at, placed.template.at, pose);
      placed.inner = placed.template.inner;
      placed.outer = placed.template.outer;
      break;
    case 'cone':
    case 'lane':
      writeHeaded(placed, pose);
      break;
    case 'polygon':
      writePolygon(placed, pose);
      break;
    case 'outside':
      write(placed.shape, pose);
      break;
    case 'union':
      for (const part of placed.shapes) {
        write(part, pose);
      }

      break;
    case 'difference':
      write(placed.base, pose);
      write(placed.minus, pose);
      break;
  }
};

/**
 * Places an area trigger's shape (§II.3.5): a template relative to the area trigger (the origin at its position, its
 * headings turned by its heading, a polygon's points turned with it) written into a placed copy it keeps, so placing
 * the same template again allocates nothing. A new template (a shape function's new result) builds a new copy.
 */
export class ShapePlacer {
  #template: Shape | undefined = undefined;
  #placed: Placed = { kind: 'point', at: { x: 0, z: 0 }, template: ORIGIN_POINT };
  #heading = Number.NaN;
  readonly #pose: Pose = { x: 0, z: 0, sin: 0, cos: 1, heading: 0 };

  /** The shape as last placed. */
  get shape(): Shape {
    return this.#placed;
  }

  /** Places a template at a position and heading, and returns the placed shape. */
  place(template: Shape, at: Vec2, heading: number): Shape {
    const pose = this.#pose;

    if (template !== this.#template) {
      this.#template = template;
      this.#placed = mirror(template);
    }

    if (heading !== this.#heading) {
      this.#heading = heading;
      pose.sin = heading === 0 ? 0 : Math.sin(heading);
      pose.cos = heading === 0 ? 1 : Math.cos(heading);
      pose.heading = heading;
    }

    pose.x = at.x;
    pose.z = at.z;
    write(this.#placed, pose);

    return this.#placed;
  }

  /** Forgets its template, so it keeps no reference to a definition's data. */
  clear(): void {
    this.#template = undefined;
    this.#placed = { kind: 'point', at: { x: 0, z: 0 }, template: ORIGIN_POINT };
  }
}
