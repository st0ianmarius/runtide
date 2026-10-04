import type { Box, MutableVec2, Shape, Vec2 } from '../math/index.ts';
import type { BodyMove, PointPick, QueryOptions, RangeOptions, Reaction, SweepOptions, WorldQuery } from './query.ts';
import { RewindLevel, type RewindOptions } from './rewind-level.ts';
import { Selection } from './selection.ts';

export type { RewindOptions } from './rewind-level.ts';

/** A level's rewind parts: its searches and the selection they run. */
interface Level<Unit> {
  /** The searches. */
  readonly rewind: RewindLevel<Unit>;

  /** The reused selection. */
  readonly selection: Selection<Unit>;
}

/** A rewound view of a world: a class for fast properties, its functions arrow fields so they work detached. */
class Rewound<Unit> implements WorldQuery<Unit> {
  readonly #world: WorldQuery<Unit>;
  readonly #options: RewindOptions<Unit>;

  /** A level per nesting depth: a filter or a targeting rule may search the view again. */
  readonly #levels: Level<Unit>[] = [];
  #depth = 0;

  /** What `positionOf` reads through: it writes only the caller's vector, so it is shared by every level. */
  readonly #reader: RewindLevel<Unit>;

  constructor(world: WorldQuery<Unit>, options: RewindOptions<Unit>) {
    this.#world = world;
    this.#options = options;
    this.#reader = new RewindLevel(world, options);
  }

  get bounds(): Box {
    return this.#world.bounds;
  }

  get extensions(): readonly string[] {
    return this.#world.extensions;
  }

  readonly positionOf = (unit: Unit, out: MutableVec2): Vec2 => this.#reader.positionOf(unit, out);

  readonly previousOf = (unit: Unit, out: MutableVec2): Vec2 => this.#world.previousOf(unit, out);
  readonly velocityOf = (unit: Unit, out: MutableVec2): Vec2 => this.#world.velocityOf(unit, out);
  readonly radiusOf = (unit: Unit): number => this.#world.radiusOf(unit);
  readonly sideOf = (unit: Unit): number => this.#world.sideOf(unit);
  readonly reactionOf = (a: Unit, b: Unit): Reaction => this.#world.reactionOf(a, b);
  readonly idOf = (unit: Unit): number => this.#world.idOf(unit);
  readonly lineClear = (from: Vec2, to: Vec2, radius?: number): boolean => this.#world.lineClear(from, to, radius);
  readonly isPositionClear = (p: Vec2, radius: number): boolean => this.#world.isPositionClear(p, radius);
  readonly clamp = (p: Vec2, radius?: number): Vec2 => this.#world.clamp(p, radius);
  readonly moveBody = (from: Vec2, to: Vec2, radius: number): BodyMove => this.#world.moveBody(from, to, radius);
  readonly pickPoint = (pick: PointPick): Vec2 | undefined => this.#world.pickPoint(pick);

  readonly inside = (shape: Shape, options: QueryOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { rewind, selection } = this.#enter();

    try {
      return rewind.write(rewind.run(selection.over(shape, options)), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly all = (options: QueryOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { rewind, selection } = this.#enter();

    try {
      return rewind.write(rewind.run(selection.over(undefined, options)), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly count = (shape: Shape | undefined, options: QueryOptions<Unit>): number => {
    const { rewind, selection } = this.#enter();

    try {
      return rewind.run(selection.over(shape, options));
    } finally {
      this.#depth -= 1;
    }
  };

  readonly nearest = (from: Vec2, options: RangeOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { rewind, selection } = this.#enter();

    try {
      return rewind.write(rewind.run(selection.around(from, options)), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly sweep = (from: Vec2, to: Vec2, options: SweepOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { rewind, selection } = this.#enter();

    try {
      return rewind.write(rewind.run(selection.along(from, to, options)), out, options.shares);
    } finally {
      this.#depth -= 1;
    }
  };

  /** Takes the next nesting level's parts; `#depth -= 1` gives them back. */
  #enter(): Level<Unit> {
    const level = (this.#levels[this.#depth] ??= {
      rewind: new RewindLevel(this.#world, this.#options),
      selection: new Selection<Unit>()
    });

    this.#depth += 1;

    return level;
  }
}

/**
 * A view of a world as a client drew it (lag compensation): `positionOf` reads each unit's `Trail` at the rewind's
 * (fractional) `tick`, a unit with no trail where it stands now; `inside`, `all`, `count`, `nearest` and `sweep` gather
 * candidates from the live world with their reach widened by `slack`, then test each one at its trail position and
 * order them there (lower entity id on ties), so a press checked on the server hits what the client saw. A relative
 * sweep runs against each unit's trail from `tick − 1` to `tick`. Every other query (previous positions, velocities,
 * radii, sides, static geometry) is the live world's. The options are read at each search, so a game may keep one view
 * over an options object of its own and move its `tick` per press. Allocation-free once warm: each nesting level reuses
 * its scratch lists, as the memory world's queries do.
 */
export const rewoundQuery = <Unit>(world: WorldQuery<Unit>, options: RewindOptions<Unit>): WorldQuery<Unit> =>
  Object.freeze(new Rewound(world, options));
