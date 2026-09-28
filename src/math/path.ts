import { covers } from './covers.ts';
import { PathCandidates } from './path-candidates.ts';
import type { Shape } from './shapes.ts';
import type { Vec2 } from './vec2.ts';

/**
 * A body's path over one tick (§II.6 W6): it moves in a straight line from `from` at time `t0` to `to` at time `t1`,
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

  /** How many even pieces a shape that changes over the tick is sampled in; 8 by default. */
  readonly steps?: number;
}

/**
 * A shape that changes over the tick (a ring of fire spreading): the shape at a share of the tick, from 0 at `t0` to
 * 1 at `t1`. The path tests take it at the middle of each of the path's `steps` pieces.
 */
export type ShapeAt = (share: number) => Shape;

/** A span of time, in seconds. */
export interface TimeWindow {
  /** When it opens. */
  readonly from: number;

  /** When it closes. */
  readonly to: number;
}

/** Which part of the tick counts as exposure. */
export interface ExposureOptions {
  /** Only this window counts (the part of the tick the body is exposed in); the whole tick when absent. */
  readonly only?: TimeWindow;

  /** This window does not count (a sub-tick invulnerability window); nothing is taken out when absent. */
  readonly except?: TimeWindow;
}

/** One crossing of a shape's edge along a path, which `pathCrossings` writes. Reused: read it, never keep it. */
export interface PathCrossing {
  /** When the body crosses, in seconds. */
  time: number;

  /** Whether it enters the shape there (false: it leaves). */
  isEntering: boolean;
}

/** Below this a share is the same share: candidates closer than it are one crossing. */
const SAME_SHARE = 1e-12;

const candidates = new PathCandidates();
const pieces: number[] = [];
const scratch: number[] = [];

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

/** Where a piece of a path runs, as shares of the whole, and how many intervals are written so far. */
interface PieceParts {
  /** The piece's start and end shares. */
  span: readonly [number, number];

  /** The intervals written so far. */
  count: number;
}

/**
 * Writes the shares of the segment `a → b` (itself the piece `[s0, s1]` of the whole path) that `shape` covers, as
 * shares of the whole path, appending to `out`; returns the new interval count.
 */
const piece = (shape: Shape, path: TickPath, parts: PieceParts): void => {
  const [s0, s1] = parts.span;
  const a = along(path.from, path.to, s0);
  const b = along(path.from, path.to, s1);
  const radius = path.radius ?? 0;

  candidates.gather(shape, [a, b], radius);

  const { shares } = candidates;

  sortShares(shares, candidates.count);

  let previous = 0;

  for (let i = 0; i <= candidates.count; i++) {
    const next = i < candidates.count ? (shares[i] ?? 1) : 1;

    if (next - previous > SAME_SHARE && covers(shape, along(a, b, (previous + next) / 2), radius)) {
      parts.count = push(pieces, parts.count, [s0 + (s1 - s0) * previous, s0 + (s1 - s0) * next]);
    }

    previous = Math.max(previous, next);
  }
};

/** The shares of the whole path that `shape` covers, into `pieces`; returns how many intervals. */
const coveredShares = (shape: Shape | ShapeAt, path: TickPath): number => {
  const parts: PieceParts = { span: [0, 1], count: 0 };

  if (typeof shape !== 'function') {
    piece(shape, path, parts);

    return parts.count;
  }

  const steps = Math.max(1, Math.floor(path.steps ?? 8));

  for (let k = 0; k < steps; k++) {
    parts.span = [k / steps, (k + 1) / steps];
    piece(shape((k + 0.5) / steps), path, parts);
  }

  return parts.count;
};

/**
 * Writes when a body on `path` is inside `shape` (as `covers` counts it, for the body's radius) into `out`, as pairs
 * of times in seconds from index 0 (`[enter, leave, enter, leave, …]`), in order and joined where they meet, and
 * returns how many intervals. Exact for a fixed shape: every edge crossing is solved, and the pieces between are tested
 * with `covers` itself, so the rims follow its rules. A shape that changes over the tick is sampled per piece.
 */
export const pathIntervals = (shape: Shape | ShapeAt, path: TickPath, out: number[]): number => {
  const count = coveredShares(shape, path);
  const span = path.t1 - path.t0;

  for (let i = 0; i < count * 2; i++) {
    out[i] = path.t0 + span * (pieces[i] ?? 0);
  }

  return count;
};

/** The length of the overlap between `[a, b]` and a window. */
const overlap = (a: number, b: number, window: TimeWindow): number =>
  Math.max(0, Math.min(b, window.to) - Math.max(a, window.from));

/**
 * The seconds a body on `path` spends inside `shape` (§II.6 W6: a pool's exposure over one tick), counting only the
 * window `only` and leaving out the window `except` when given. Overlapping shapes of one kind are the game's union
 * (`union(...)`), so a unit in two pools is not exposed twice.
 */
export const secondsInside = (shape: Shape | ShapeAt, path: TickPath, options: ExposureOptions = {}): number => {
  const count = pathIntervals(shape, path, scratch);
  const only = options.only ?? { from: path.t0, to: path.t1 };
  let seconds = 0;

  for (let i = 0; i < count; i++) {
    const a = Math.max(scratch[i * 2] ?? 0, only.from);
    const b = Math.min(scratch[i * 2 + 1] ?? 0, only.to);

    if (b > a) {
      seconds += b - a - (options.except === undefined ? 0 : overlap(a, b, options.except));
    }
  }

  return seconds;
};

/** Writes one crossing into `out` at `index`, reusing the record there. */
const writeCrossing = (out: PathCrossing[], index: number, crossing: PathCrossing): void => {
  const record = out[index];

  if (record === undefined) {
    out[index] = { time: crossing.time, isEntering: crossing.isEntering };
  } else {
    record.time = crossing.time;
    record.isEntering = crossing.isEntering;
  }
};

/**
 * Writes every crossing of `shape`'s edge along `path` into `out` from index 0, in time order, and returns how many:
 * the edge-crossing hook of §II.6 W6 (a ring of fire that is lethal to cross). Being inside at `t0` or at `t1` is not
 * a crossing. `out` keeps its records, which are rewritten in place.
 */
export const pathCrossings = (shape: Shape | ShapeAt, path: TickPath, out: PathCrossing[]): number => {
  const count = pathIntervals(shape, path, scratch);
  let written = 0;

  for (let i = 0; i < count; i++) {
    const enter = scratch[i * 2] ?? 0;
    const leave = scratch[i * 2 + 1] ?? 0;

    if (enter > path.t0) {
      writeCrossing(out, written, { time: enter, isEntering: true });
      written += 1;
    }

    if (leave < path.t1) {
      writeCrossing(out, written, { time: leave, isEntering: false });
      written += 1;
    }
  }

  return written;
};
