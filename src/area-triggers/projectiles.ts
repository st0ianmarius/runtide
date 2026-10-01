import { angleDelta, hypot, type MutableVec2, type Vec2, wrap } from '../math/index.ts';
import type { QuerySide, RangeOptions, UnitSet } from '../world/index.ts';
import type { AreaTriggerContext } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';

/** What `retarget` looks for: a reach from the point, and who is left out. */
export interface RetargetOptions<G extends AreaTriggerTypes> {
  /** How far from the point a unit may be. */
  readonly range: number;

  /** Which side, relative to the area trigger's owner; `foes` by default. */
  readonly side?: QuerySide;

  /** A hit ledger of its kind, by name: the units it recorded are left out (a chain's links, a cast's hits). */
  readonly ledger?: string;

  /** Units left out besides (the targets its siblings reserved). */
  readonly exclude?: UnitSet<G['bearer']>;

  /** A condition a unit must meet (line of sight from the point). */
  readonly filter?: (unit: G['bearer']) => boolean;

  /** Distances run to a unit's centre (the default) or to the edge of its body. */
  readonly measure?: 'centre' | 'edge';
}

/** The reused query of one `retarget` call, by nesting level: a filter may ask again. */
class RetargetQuery<G extends AreaTriggerTypes> implements RangeOptions<G['bearer']> {
  range = 0;
  side: QuerySide = 'foes';
  of: G['bearer'];
  ofSide = 0;
  measure: 'centre' | 'edge' = 'centre';
  readonly order = 'near';
  readonly limit = 1;
  skip: UnitSet<G['bearer']> | undefined = undefined;
  also: UnitSet<G['bearer']> | undefined = undefined;
  test: ((unit: G['bearer']) => boolean) | undefined = undefined;
  readonly out: (G['bearer'] | undefined)[] = [];

  constructor(of: G['bearer']) {
    this.of = of;
  }

  /** Whether a unit is neither recorded nor excluded, and passes the condition. */
  readonly filter = (unit: G['bearer']): boolean =>
    this.skip?.has(unit) !== true && this.also?.has(unit) !== true && (this.test?.(unit) ?? true);
}

/** The reused queries, by nesting level, shared by every game: each is checked as it is taken. */
const queries: unknown[] = [];
let depth = 0;

/** Whether a kept query is one; `G` is named only by the result, as one query serves every game's units alike. */
const isQuery = <G extends AreaTriggerTypes>(query: unknown): query is RetargetQuery<G> =>
  query instanceof RetargetQuery;

/** The query of the current nesting level, made at its first use. */
const queryFor = <G extends AreaTriggerTypes>(owner: G['bearer']): RetargetQuery<G> => {
  const kept = queries[depth];

  if (isQuery<G>(kept)) {
    kept.of = owner;

    return kept;
  }

  const made = new RetargetQuery<G>(owner);

  queries[depth] = made;

  return made;
};

/**
 * The next unit an area trigger goes for from a point (a chain's next link, a ricochet's or a fork's target, a homing
 * shot's new mark when its own is gone): the nearest within `range` on its side, leaving out what its `ledger` recorded
 * and what `exclude` holds, ties to the lower entity id; `undefined` when there is none.
 */
export const retarget = <G extends AreaTriggerTypes>(
  c: AreaTriggerContext<G>,
  from: Vec2,
  options: RetargetOptions<G>
): G['bearer'] | undefined => {
  const query = queryFor<G>(c.owner);

  query.range = options.range;
  query.side = options.side ?? 'foes';
  query.ofSide = c.side;
  query.measure = options.measure ?? 'centre';
  query.skip = options.ledger === undefined ? undefined : c.ledger(options.ledger);
  query.also = options.exclude;
  query.test = options.filter;
  depth += 1;

  try {
    return c.world.nearest(from, query, query.out) > 0 ? query.out[0] : undefined;
  } finally {
    depth -= 1;
    query.skip = undefined;
    query.also = undefined;
    query.test = undefined;
    query.out[0] = undefined;
  }
};

/** The point a piece of `pursue` ends at, reused: `advance` reads it at once. */
const stop: MutableVec2 = { x: 0, z: 0 };

/**
 * Moves an area trigger toward a point by up to `step` (its travel over the rest of this frame), its contact sweeping
 * the way (`advance`): it turns its heading toward the point, by at most `turn` radians when given (a cyclone's turn
 * rate), and goes `step` along it, or stops on the point once it faces it and is within reach. Returns the travel left
 * over: above 0 when it arrived with some to spare (a glaive flying on to its next mark), 0 otherwise. The piece ends
 * at its share of the frame, so its sweep meets the units where they are at that moment. For a `move` or `frame` hook.
 */
export const pursue = <G extends AreaTriggerTypes>(
  c: AreaTriggerContext<G>,
  to: Vec2,
  step: number,
  turn = Infinity
): number => {
  const { position } = c;
  const dx = to.x - position.x;
  const dz = to.z - position.z;
  const length = hypot(dx, dz);

  if (!(step > 0) || length === 0) {
    return length === 0 ? Math.max(0, step) : 0;
  }

  const delta = angleDelta(c.heading, Math.atan2(dx, dz));
  const faces = Math.abs(delta) <= turn;

  c.heading = wrap(c.heading + (faces ? delta : Math.sign(delta) * turn));

  if (faces && length <= step) {
    const from = c.advancedAt;

    stop.x = to.x;
    stop.z = to.z;
    c.advance(stop, from + (1 - from) * (length / step));

    return step - length;
  }

  // Facing the point, it goes straight at it, along the exact direction rather than its heading's rounded one.
  stop.x = position.x + (faces ? dx / length : Math.sin(c.heading)) * step;
  stop.z = position.z + (faces ? dz / length : Math.cos(c.heading)) * step;
  c.advance(stop);

  return 0;
};

/** Where `pursueUnit` reads its mark, reused. */
const mark: MutableVec2 = { x: 0, z: 0 };

/**
 * Moves an area trigger toward a unit where it stands now (`pursue`): a homing shot on its mark, or a glaive or a
 * chakram coming back to its owner (`c.owner`). Returns whether it got within `reach` of the unit (0 by default: onto
 * it), where a return is caught.
 */
export const pursueUnit = <G extends AreaTriggerTypes>(
  c: AreaTriggerContext<G>,
  unit: G['bearer'],
  step: number,
  options: {
    /** The most it turns this frame, in radians; any turn when absent. */
    readonly turn?: number;

    /** How near counts as reaching it; 0 by default. */
    readonly reach?: number;
  } = {}
): boolean => {
  const at = (c.host.positionOf ?? c.world.positionOf)(unit, mark);
  const x = at.x;
  const z = at.z;

  if (pursue(c, at, step, options.turn) > 0) {
    return true;
  }

  return hypot(x - c.position.x, z - c.position.z) <= (options.reach ?? 0);
};

/**
 * The heading of the `index`-th of `count` shots fanned evenly across `spread` radians around `heading` (a volley,
 * a fork): the first at one edge, the last at the other, one alone straight on. Shots all round a circle are
 * `spread = 2π × (count − 1) / count`.
 */
export const fanHeading = (index: number, count: number, spread: number, heading = 0): number =>
  count <= 1 ? wrap(heading) : wrap(heading - spread / 2 + (spread * index) / (count - 1));
