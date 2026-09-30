import { covers } from './covers.ts';
import { PathCandidates } from './path-candidates.ts';
import type { Shape } from './shapes.ts';
import type { Vec2 } from './vec2.ts';

/**
 * A body's path over one tick: it moves in a straight line from `from` at time `t0` to `to` at time `t1`,
 * at an even pace, reaching `radius` around its centre.
 */
export interface TickPath {
  /** Where it starts. */
  readonly from: Vec2;

  /** Where it ends. */
  readonly to: Vec2;

  /** When it is at `from`, in seconds. */
  readonly t0: number;

  /** When it is at `to`, in seconds; not before `t0`. */
  readonly t1: number;

  /** How far the body reaches around its centre; 0 (a bare point) by default. */
  readonly radius?: number;
}

/** Below this a share is the same share: candidates closer than it are one crossing. */
const SAME_SHARE = 1e-12;

const candidates = new PathCandidates();

/** Sorts the first `count` candidates in place, ascending (few enough that insertion sort wins). */
const sortShares = (shares: number[], count: number): void => {
  for (let i = 1; i < count; i++) {
    const share = shares[i] ?? 0;
    let j = i - 1;

    while (j >= 0 && (shares[j] ?? 0) > share) {
      shares[j + 1] = shares[j] ?? 0;
      j -= 1;
    }

    shares[j + 1] = share;
  }
};

/** Appends an interval to `out` (pairs from index 0, `count` intervals so far), joining one that meets the last. */
const push = (out: number[], count: number, [start, end]: readonly [number, number]): number => {
  if (count > 0 && Math.abs((out[count * 2 - 1] ?? 0) - start) <= SAME_SHARE) {
    out[count * 2 - 1] = end;

    return count;
  }

  out[count * 2] = start;
  out[count * 2 + 1] = end;

  return count + 1;
};

/** The point a share of the way along a segment. */
const along = (from: Vec2, to: Vec2, t: number): Vec2 => ({
  x: from.x + (to.x - from.x) * t,
  z: from.z + (to.z - from.z) * t,
});

/**
 * Writes when a body on `path` is inside `shape` (as `covers` counts it, for the body's radius) into `out`, as pairs
 * of times in seconds from index 0 (`[enter, leave, enter, leave, …]`), in order and joined where they meet, and
 * returns how many intervals. Exact: every edge crossing is solved, and the pieces between are tested with `covers`
 * itself, so the rims follow its rules. A game builds its own exposure (seconds inside a pool, a lethal crossing) on it.
 */
export const pathIntervals = (shape: Shape, path: TickPath, out: number[]): number => {
  const { from, to, t0, t1 } = path;
  const radius = path.radius ?? 0;

  candidates.gather(shape, [from, to], radius);

  const { shares } = candidates;

  sortShares(shares, candidates.count);

  let count = 0;
  let previous = 0;

  for (let i = 0; i <= candidates.count; i++) {
    const next = i < candidates.count ? (shares[i] ?? 1) : 1;

    if (next - previous > SAME_SHARE && covers(shape, along(from, to, (previous + next) / 2), radius)) {
      count = push(out, count, [t0 + (t1 - t0) * previous, t0 + (t1 - t0) * next]);
    }

    previous = Math.max(previous, next);
  }

  return count;
};
