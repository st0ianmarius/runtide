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
   * radius), and says where it stopped.
   */
  readonly moveBody = (segment: readonly [Vec2, Vec2], radius: number): BodyMove => {
    const [from, to] = segment;
    const contact = this.#statics.contact(segment, radius);
    const exit = this.#boundsExit(segment, radius);
    const share = Math.min(contact ?? 1, exit);

    return {
      position: { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share },
      hit: contact !== undefined || exit < 1,
      share,
    };
  };

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
    let share = 1;

    for (const [p, q, low, high] of [
      [from.x, to.x, bounds.minX + radius, bounds.maxX - radius],
      [from.z, to.z, bounds.minZ + radius, bounds.maxZ - radius],
    ] as const) {
      if (p < low || p > high) {
        return 0;
      }

      if (q < low) {
        share = Math.min(share, (low - p) / (q - p));
      } else if (q > high) {
        share = Math.min(share, (high - p) / (q - p));
      }
    }

    return share;
  }
}
