import { type Shape, sweepCircle, type Vec2 } from '../math/index.ts';
import type { QueryOptions, QueryOrder, SweepOptions } from './query.ts';
import type { UnitTable } from './unit-table.ts';

/** A key a selection orders by: a query order, or `contact`, the share at which a sweep reaches a unit. */
export type SortKey<Unit> = QueryOrder<Unit> | 'contact';

/**
 * What one selection tests its candidates against, reused: a shape, a range around a point, a swept segment,
 * or nothing (the whole world).
 */
export class Selection<Unit> {
  /** The shape a unit must stand in; none when `undefined`. */
  shape: Shape | undefined = undefined;

  /** Whether the selection has a point of its own (a range query's). */
  hasPoint = false;

  /** The point's x. */
  x = 0;

  /** The point's z. */
  z = 0;

  /** How far from the point a unit may be; any distance when infinite. */
  range = Number.POSITIVE_INFINITY;

  /** Whether it is a sweep, whose units are those the moving body touches. */
  isSweep = false;

  /** The swept segment's start and end. */
  readonly segment = { ax: 0, az: 0, bx: 0, bz: 0 };

  /** The moving body's radius. */
  reach = 0;

  /** Whether the sweep runs against each unit's own motion this tick. */
  isRelative = false;

  /** The shares of the tick a relative sweep's segment spans. */
  since = 0;
  until = 1;

  /** Whether a unit the body already touches at the segment's start is left out. */
  isOpen = false;

  /** The options. */
  options: QueryOptions<Unit> = {};

  /** The order when the options name none. */
  order: SortKey<Unit> = 'id';

  /** Sets up a query over a shape (or the whole world), ordered by id unless the options say otherwise. */
  over(shape: Shape | undefined, options: QueryOptions<Unit>): this {
    this.#reset(options, 'id');
    this.shape = shape;

    return this;
  }

  /** Sets up a query within `range` of a point, nearest first unless the options say otherwise. */
  around(point: Vec2, options: QueryOptions<Unit> & { readonly range: number }): this {
    this.#reset(options, 'near');
    this.hasPoint = true;
    this.x = point.x;
    this.z = point.z;
    this.range = options.range;

    return this;
  }

  /** Sets up a sweep of a body along a segment, in the order it reaches units unless the options say otherwise. */
  along(from: Vec2, to: Vec2, options: SweepOptions<Unit>): this {
    this.#reset(options, 'contact');
    this.isSweep = true;
    this.isRelative = options.relative === true;
    this.since = options.since ?? 0;
    this.until = options.until ?? 1;
    this.isOpen = options.isOpen === true;
    this.segment.ax = from.x;
    this.segment.az = from.z;
    this.segment.bx = to.x;
    this.segment.bz = to.z;
    this.reach = options.radius ?? 0;

    return this;
  }

  /** Forgets the last query's setup. */
  #reset(options: QueryOptions<Unit>, order: SortKey<Unit>): void {
    this.shape = undefined;
    this.hasPoint = false;
    this.range = Number.POSITIVE_INFINITY;
    this.isSweep = false;
    this.isRelative = false;
    this.options = options;
    this.order = order;
  }
}

/** A point a sweep reuses for the circle it tests against. */
const target = { at: { x: 0, z: 0 }, r: 0 };

/** The segments a relative sweep reuses. */
const start = { x: 0, z: 0 };
const end = { x: 0, z: 0 };

/** Where a unit stood at a share of the tick, on the line from its previous position to its current one. */
const at = (previous: number, current: number, share: number): number => {
  if (share === 0) {
    return previous;
  }

  return share === 1 ? current : previous + (current - previous) * share;
};

/**
 * The share along a selection's segment at which its body first touches a slot's body, or `undefined` when it never
 * does (or touches it already at the start of an open one). A relative sweep subtracts the unit's own motion over the
 * shares of the tick the segment spans, so the two meet where they are at the same moment.
 */
export const contactShare = <Unit>(
  selection: Selection<Unit>,
  table: UnitTable<Unit>,
  slot: number
): number | undefined => {
  const { segment } = selection;
  const x = table.x[slot] ?? 0;
  const z = table.z[slot] ?? 0;

  target.r = selection.reach + (table.radius[slot] ?? 0);

  if (selection.isRelative) {
    const px = table.px[slot] ?? 0;
    const pz = table.pz[slot] ?? 0;

    start.x = segment.ax - at(px, x, selection.since);
    start.z = segment.az - at(pz, z, selection.since);
    end.x = segment.bx - at(px, x, selection.until);
    end.z = segment.bz - at(pz, z, selection.until);
    target.at.x = 0;
    target.at.z = 0;
  } else {
    start.x = segment.ax;
    start.z = segment.az;
    end.x = segment.bx;
    end.z = segment.bz;
    target.at.x = x;
    target.at.z = z;
  }

  const share = sweepCircle(start, end, target);

  // An open segment continues one that ended where it starts: a unit touched there was reached by that one.
  return share === 0 && selection.isOpen ? undefined : share;
};
