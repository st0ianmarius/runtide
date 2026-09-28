import Flatbush from 'flatbush';

import {
  boundsOf,
  type Box,
  type Circle,
  covers,
  emptyBox,
  pathIntervals,
  type Polygon,
  type Vec2,
} from '../math/index.ts';

/** A piece of static geometry: a wall, a pillar, a zone that never moves. */
export type StaticShape = Circle | Polygon;

/**
 * The static geometry of a memory world in a packed R-tree (`flatbush`, §I.5.1), built once: what bodies are swept
 * against and lines of sight are tested through. Contact follows `covers`, so a body touches a pillar when their
 * edges overlap.
 */
export class StaticGeometry {
  readonly #shapes: readonly StaticShape[];
  readonly #tree: Flatbush | undefined;
  readonly #box = emptyBox();
  readonly #times: number[] = [];

  constructor(shapes: readonly StaticShape[]) {
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

    return hits.every((index) => {
      const shape = this.#shapes[index];

      return shape === undefined || !covers(shape, p, radius);
    });
  }

  /**
   * The earliest share along `from → to` at which a body of `radius` touches a static shape (0 when it starts in
   * one), or `undefined` when it touches none.
   */
  contact(segment: readonly [Vec2, Vec2], radius: number): number | undefined {
    const tree = this.#tree;

    if (tree === undefined) {
      return undefined;
    }

    const [from, to] = segment;
    const box = this.#sweptBox(segment, radius);
    let earliest: number | undefined = undefined;

    for (const index of tree.search(box.minX, box.minZ, box.maxX, box.maxZ)) {
      const shape = this.#shapes[index];
      const count = shape === undefined ? 0 : pathIntervals(shape, { from, to, t0: 0, t1: 1, radius }, this.#times);
      const share = this.#times[0] ?? 1;

      if (count > 0 && (earliest === undefined || share < earliest)) {
        earliest = share;
      }
    }

    return earliest;
  }

  /** The box a body of `radius` sweeps along a segment. */
  #sweptBox([from, to]: readonly [Vec2, Vec2], radius: number): Box {
    const box = this.#box;

    box.minX = Math.min(from.x, to.x) - radius;
    box.minZ = Math.min(from.z, to.z) - radius;
    box.maxX = Math.max(from.x, to.x) + radius;
    box.maxZ = Math.max(from.z, to.z) + radius;

    return box;
  }
}
