import type { Box, Vec2 } from '../math/index.ts';
import type { BodyMove, PointPick } from './query.ts';
import type { StaticGeometry } from './statics.ts';

/**
 * The static side of a memory world: its bounds and its static geometry, and the placement queries over them
 *: clearance, clamping, a body's move and the sample-and-score point picker.
 */
export class Placement {
  readonly bounds: Box;
  readonly #statics: StaticGeometry;
  readonly #normal = { x: 0, z: 0 };

  constructor(bounds: Box, statics: StaticGeometry) {
    this.bounds = bounds;
    this.#statics = statics;
  }

  /** Whether a body of `radius` at `p` lies inside the bounds (touching them is inside) and clear of static shapes. */
  readonly isPositionClear = (p: Vec2, radius: number): boolean => {
    const { bounds } = this;

    return (
      p.x - radius >= bounds.minX &&
      p.x + radius <= bounds.maxX &&
      p.z - radius >= bounds.minZ &&
      p.z + radius <= bounds.maxZ &&
      this.#statics.isClear(p, radius)
    );
  };

  /** Whether a body of `radius` (0 by default) passes from one point to the other without touching static shapes. */
  readonly lineClear = (from: Vec2, to: Vec2, radius = 0): boolean =>
    this.#statics.contact([from, to], radius) === undefined;

  /** `p` moved inside the bounds, inset by `radius` (0 by default), as a new vector. */
  readonly clamp = (p: Vec2, radius = 0): Vec2 => {
    const { bounds } = this;

    return {
      x: Math.min(bounds.maxX - radius, Math.max(bounds.minX + radius, p.x)),
      z: Math.min(bounds.maxZ - radius, Math.max(bounds.minZ + radius, p.z)),
    };
  };

  /**
   * Moves a body of `radius` along a segment until it touches static geometry or would leave the bounds (inset by its
   * radius), and says where it stopped and the normal of what it touched (for a slide along a wall, a ricochet). A
   * body that starts overlapping a shape and moves away from it goes free.
   */
  readonly moveBody = (segment: readonly [Vec2, Vec2], radius: number): BodyMove => {
    const [from, to] = segment;
    const contact = this.#statics.contact(segment, radius);
    const exit = this.#boundsExit(segment, radius);
    const share = Math.min(contact ?? 1, exit);
    const position = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share };

    if (contact === undefined && exit >= 1) {
      return { position, hit: false, share };
    }

    const normal =
      contact !== undefined && contact <= exit ? this.#statics.normalOf(position, this.#normal) : undefined;

    return { position, hit: true, share, normal: { ...(normal ?? this.#boundsNormal(position, radius)) } };
  };

  /** The inward normal of the bound a body at `p` presses against: the nearest one. */
  #boundsNormal(p: Vec2, radius: number): Vec2 {
    const { bounds } = this;
    const out = this.#normal;
    const left = p.x - radius - bounds.minX;
    const right = bounds.maxX - radius - p.x;
    const back = p.z - radius - bounds.minZ;
    const least = Math.min(left, right, back, bounds.maxZ - radius - p.z);

    out.x = 0;
    out.z = 0;

    if (least === left) {
      out.x = 1;
    } else if (least === right) {
      out.x = -1;
    } else if (least === back) {
      out.z = 1;
    } else {
      out.z = -1;
    }

    return out;
  }

  /**
   * Picks a point: each attempt's candidate from the game's sampler, kept when it is clear by the clearance and passes
   * the filter; the highest score wins, the first on ties, and without a score the first candidate that passes.
   * `undefined` when none did.
   */
  readonly pickPoint = (pick: PointPick): Vec2 | undefined => {
    let best: Vec2 | undefined = undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let attempt = 0; attempt < pick.attempts; attempt++) {
      const sample = pick.sample(attempt);

      if (
        sample === undefined ||
        !this.isPositionClear(sample, pick.clearance ?? 0) ||
        pick.filter?.(sample) === false
      ) {
        continue;
      }

      if (pick.score === undefined) {
        return sample;
      }

      const score = pick.score(sample);

      if (score > bestScore) {
        best = sample;
        bestScore = score;
      }
    }

    return best;
  };

  /** The share at which a body's centre leaves the bounds inset by its radius (0 when it starts outside, 1 if never). */
  #boundsExit([from, to]: readonly [Vec2, Vec2], radius: number): number {
    const { bounds } = this;

    return Math.min(
      axisExit([from.x, to.x], [bounds.minX + radius, bounds.maxX - radius]),
      axisExit([from.z, to.z], [bounds.minZ + radius, bounds.maxZ - radius]),
    );
  }
}

/** The share at which a move along one axis leaves `[low, high]`: 0 when it starts outside, 1 if never. */
const axisExit = ([p, q]: readonly [number, number], [low, high]: readonly [number, number]): number => {
  if (p < low || p > high) {
    return 0;
  }

  if (q < low) {
    return (low - p) / (q - p);
  }

  return q > high ? (high - p) / (q - p) : 1;
};
