import type { Shape } from './shapes.ts';
import { ORIGIN, type Vec2 } from './vec2.ts';

/** An axis-aligned box on the ground plane, edges included. */
export interface Box {
  /** The least x. */
  readonly minX: number;

  /** The least z. */
  readonly minZ: number;

  /** The greatest x. */
  readonly maxX: number;

  /** The greatest z. */
  readonly maxZ: number;
}

/** A box a caller reuses: what `boundsOf` writes into. */
export interface MutableBox {
  /** The least x. */
  minX: number;

  /** The least z. */
  minZ: number;

  /** The greatest x. */
  maxX: number;

  /** The greatest z. */
  maxZ: number;
}

/** A new box that holds nothing yet (every bound inverted), ready to grow. */
export const emptyBox = (): MutableBox => ({
  minX: Number.POSITIVE_INFINITY,
  minZ: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxZ: Number.NEGATIVE_INFINITY
});

/** Grows `box` to hold the point `(x, z)`. */
const include = (box: MutableBox, x: number, z: number): void => {
  box.minX = Math.min(box.minX, x);
  box.minZ = Math.min(box.minZ, z);
  box.maxX = Math.max(box.maxX, x);
  box.maxZ = Math.max(box.maxZ, z);
};

/** Grows `box` to hold the square of half-size `r` around `at`. */
const growAround = (box: MutableBox, at: Vec2, r: number): void => {
  box.minX = Math.min(box.minX, at.x - r);
  box.minZ = Math.min(box.minZ, at.z - r);
  box.maxX = Math.max(box.maxX, at.x + r);
  box.maxZ = Math.max(box.maxZ, at.z + r);
};

/** Grows `box` to hold a lane's four corners, each pushed out by `margin`. */
const growLane = (box: MutableBox, shape: Extract<Shape, { kind: 'lane' }>, margin: number): void => {
  const sin = Math.sin(shape.dir);
  const cos = Math.cos(shape.dir);
  const half = shape.width / 2 + margin;

  for (let i = 0; i < 4; i++) {
    const along = i < 2 ? -shape.back - margin : shape.length + margin;
    const across = i % 2 === 0 ? -half : half;

    include(box, shape.at.x + sin * along + cos * across, shape.at.z + cos * along - sin * across);
  }
};

/** Grows `box` to hold everything `shape` covers for a body reaching `margin`. */
const grow = (box: MutableBox, shape: Shape, margin: number): void => {
  switch (shape.kind) {
    case 'point':
      growAround(box, shape.at, Math.max(0, margin));
      break;
    case 'circle':
    case 'cone':
      growAround(box, shape.at, Math.max(0, shape.r + margin));
      break;
    case 'ring':
      growAround(box, shape.at, Math.max(0, shape.outer + margin));
      break;
    case 'lane':
      growLane(box, shape, margin);
      break;
    case 'polygon':
      for (const p of shape.points) {
        growAround(box, p, Math.max(0, shape.band + margin));
      }

      break;
    case 'outside':
      growAround(box, ORIGIN, Number.POSITIVE_INFINITY);
      break;
    case 'union':
      for (const part of shape.shapes) {
        grow(box, part, margin);
      }

      break;
    case 'difference':
      grow(box, shape.base, margin);
      break;
  }
};

/**
 * The box around everything `shape` covers for a body of `radius` (0 by default), written into `out` (a new box when
 * absent) and returned: what a spatial index narrows a query to before the exact `covers` test. A cone's box is its
 * whole disc's, and an `outside` reaches everywhere.
 */
export const boundsOf = (shape: Shape, radius = 0, out: MutableBox = emptyBox()): MutableBox => {
  out.minX = Number.POSITIVE_INFINITY;
  out.minZ = Number.POSITIVE_INFINITY;
  out.maxX = Number.NEGATIVE_INFINITY;
  out.maxZ = Number.NEGATIVE_INFINITY;
  grow(out, shape, radius);

  return out;
};
