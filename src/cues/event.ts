import type { Vec2 } from '../math/index.ts';
import type { CueId, CueParam } from './ids.ts';
import type { CueSchema } from './schema.ts';

/** The entity id of nobody: a `world` cue's owner, an event with no entity, an `entity` param left empty. */
export const NO_ENTITY = -1;

/**
 * One cue event: a cue id, where it sits, whose it is, and its numeric params, in the order the
 * simulation fired it. Events are pooled by their buffer: one is valid, and writable, from the `emit` that returned it
 * until the buffer is cleared, so a game may still correct one (keep the strongest impact per body) before it is
 * encoded. Nothing in the simulation reads a cue.
 *
 * A param's value sits in `values` at its slot (`CUES.params.impact.amount`): a number at the slot, a point's `x` and
 * `z` at the slot and the next, and a list of points as the index of its first coordinate in `path` and its point
 * count (point `i` is `path[first + 2i]`, `path[first + 2i + 1]`; `cuePath` copies it out).
 */
export interface CueEvent {
  /** The cue. */
  readonly cue: CueId;

  /** Whose it is: an entity id, or `NO_ENTITY` (always for a `world` cue). */
  owner: number;

  /** The entity it sits on: the owner for a `self` cue, the anchor for an `entity` cue, else `NO_ENTITY`. */
  entity: number;

  /** Where it sits: the across coordinate. */
  x: number;

  /** Where it sits: the forward coordinate. */
  z: number;

  /** A predicted cue's key, which the server's copy repeats; 0 for none. A whole number from 0. */
  key: number;

  /** The params' slots, at the cue's defaults until written. Only the cue's own slots mean anything. */
  readonly values: Float64Array;

  /** The coordinates of the event's lists of points, `x` then `z`, valid up to `pathLength`. */
  readonly path: Float64Array;

  /** How many coordinates of `path` are in use. */
  readonly pathLength: number;
}

/** The storage of a list of points that holds none. */
const NO_PATH = new Float64Array(0);

/** The pooled record behind a `CueEvent`, which only its buffer and the decoder reset. */
export class CueRecord implements CueEvent {
  cue: CueId;
  owner = NO_ENTITY;
  entity = NO_ENTITY;
  x = 0;
  z = 0;
  key = 0;
  readonly values: Float64Array;
  path: Float64Array = NO_PATH;
  pathLength = 0;

  constructor(cue: CueId, slots: number) {
    this.cue = cue;
    this.values = new Float64Array(slots);
  }

  /** Makes it a fresh event of a cue: nobody's, at the origin, no key, every param at its default. */
  reset(cue: CueId, schema: CueSchema): void {
    this.cue = cue;
    this.owner = NO_ENTITY;
    this.entity = NO_ENTITY;
    this.x = 0;
    this.z = 0;
    this.key = 0;
    this.pathLength = 0;

    // Copied by index: a cue has a handful of slots, where a typed-array `set` costs more than the copy.
    for (let i = 0; i < schema.size; i++) {
      this.values[i] = schema.defaults[i] ?? 0;
    }
  }

  /** Makes room for `count` more coordinates in `path`, keeping what is there, and returns where they start. */
  reservePath(count: number): number {
    const start = this.pathLength;
    const needed = start + count;

    if (needed > this.path.length) {
      const grown = new Float64Array(Math.max(needed, this.path.length * 2, 16));

      grown.set(this.path.subarray(0, start));
      this.path = grown;
    }

    this.pathLength = needed;

    return start;
  }
}

/** The pooled record behind an event, which every buffer hands out; throws for an event made elsewhere. */
export const cueRecordOf = (event: CueEvent): CueRecord => {
  if (!(event instanceof CueRecord)) {
    throw new TypeError('A cue event must come from a cue buffer.');
  }

  return event;
};

/**
 * Writes a list of points into a list-of-points param (`CUES.params.chain.links`): copies their coordinates into the
 * event's `path`, so the caller's array is not kept. Writing the param again replaces the list.
 */
export const setCuePath = (event: CueEvent, param: CueParam, points: readonly Vec2[]): void => {
  const record = cueRecordOf(event);
  const start = record.reservePath(points.length * 2);

  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    record.path[start + i * 2] = point?.x ?? 0;
    record.path[start + i * 2 + 1] = point?.z ?? 0;
  }

  record.values[param] = start;
  record.values[param + 1] = points.length;
};

/** A copy of a list-of-points param's points, as new vectors: for tools, tests and a client's playback, not a hot path. */
export const cuePath = (event: CueEvent, param: CueParam): Vec2[] => {
  const start = event.values[param] ?? 0;
  const count = event.values[param + 1] ?? 0;

  return Array.from({ length: count }, (_unused, index) => ({
    x: event.path[start + index * 2] ?? 0,
    z: event.path[start + index * 2 + 1] ?? 0
  }));
};
