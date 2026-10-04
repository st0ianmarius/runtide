import { digest } from '../core/digest.ts';
import { type Box, hypot, type MutableVec2, type Shape, type Vec2 } from '../math/index.ts';
import { Placement } from './placement.ts';
import { GridIndex, KdIndex, type PointIndex } from './point-index.ts';
import type { BodyMove, PointPick, QueryOptions, RangeOptions, Reaction, SweepOptions, WorldQuery } from './query.ts';
import { type SearchParts, sweep } from './searches.ts';
import { Selection } from './selection.ts';
import { bySides, type ReactionRule, Selector, type SideTargetRule, type TargetRule } from './selector.ts';
import { StaticGeometry, type StaticShape } from './statics.ts';
import { checkPosition, type UnitSpec, UnitTable, type WorldSlots } from './unit-table.ts';

/** What a memory world is created with. */
export interface MemoryWorldOptions<Unit = unknown> {
  /** The world's bounds: the grid covers them, and bodies stay inside them. */
  readonly bounds: Box;

  /** The point index: a uniform grid updated as units move (the default), or a k-d tree rebuilt when they did. */
  readonly index?: 'grid' | 'kd';

  /** The grid's cell size; 4 by default. Near the typical query radius is a good size. */
  readonly cell?: number;

  /** The tick's length in seconds, which velocities are measured over; 1 by default. */
  readonly dt?: number;

  /** The static geometry (walls, pillars), indexed in an R-tree: the default group of `setStatics`. */
  readonly statics?: readonly StaticShape[];

  /**
   * The game's rule for how sides regard each other (a neutral side, a free for all, factions); one side friendly and
   * two hostile by default.
   */
  readonly reaction?: ReactionRule;

  /**
   * The game's targeting rule, asked of every query with a unit asking (`of`): whether it may pick a unit at all
   * (stealth against detection, a phased or untargetable unit, a spawn intro). Every unit may when absent.
   */
  readonly canTarget?: TargetRule<Unit>;

  /**
   * The game's targeting rule for a query by side alone (`ofSide` with no `of`: a world script's hazard), asked with
   * that side. Every unit may when absent, so such a query then bypasses `canTarget`'s rule.
   */
  readonly canTargetSide?: SideTargetRule<Unit>;

  /**
   * A unit's entity id, the one it is added under (`unit.id`): with it the world finds a unit's slot by its id, in a
   * table of typed arrays, instead of by the unit object in a map: every position read and placement is cheaper.
   */
  readonly idOf?: (unit: Unit) => number;

  /** Where each unit's slot is kept on the unit (`WorldSlots`): finding a unit is then one read, cheaper still. */
  readonly slots?: WorldSlots<Unit>;
}

/**
 * A reference world: every `WorldQuery` over units the host adds, moves and removes, with a point index for the
 * moving units and an R-tree for static geometry. For tests and small games; a game with a world of its own
 * implements `WorldQuery` over it instead. The host calls `tick` at the start of each tick, so previous positions and
 * velocities cover the tick's moves.
 */
export interface MemoryWorld<Unit> extends WorldQuery<Unit> {
  /** How many units are in the world. */
  readonly size: number;

  /** Whether a unit is in the world. */
  readonly has: (unit: Unit) => boolean;

  /** Adds a unit; throws when it is already here, or its position or radius is not finite. */
  readonly add: (unit: Unit, spec: UnitSpec) => void;

  /** Removes a unit; false when it was not here. */
  readonly remove: (unit: Unit) => boolean;

  /** Moves a unit to `at` now; throws for a position that is not finite (a NaN from upstream), moving nothing. */
  readonly place: (unit: Unit, at: Vec2) => void;

  /**
   * Teleports a unit to `at`, resetting its previous position and velocity so relative sweeps see no path across
   * the jump. Later `place` calls measure motion from the destination. Throws for a position that is not finite.
   */
  readonly teleport: (unit: Unit, at: Vec2) => void;

  /** Puts a unit on another side now (a charm, a flag for combat), which every query reads from here on. */
  readonly setSide: (unit: Unit, side: number) => void;

  /**
   * Puts in a group's static geometry in place of its old (a door opened, a prison's walls raised), which every line
   * of sight, placement and body move reads from here on, with every other group's. With no group it sets the default
   * one, which holds the `statics` the world was created with; an empty list takes a group out. The list is copied,
   * so changing it later changes nothing: put it in again. A prediction mirror's static world must follow it.
   */
  readonly setStatics: (shapes: readonly StaticShape[], group?: string) => void;

  /** Starts a tick: every unit's previous position becomes its current one. */
  readonly tick: () => void;

  /**
   * Folds the world into a running state digest (`DIGEST_START` to begin): every body in ascending entity id order
   * (its id, position, radius, side, and the previous position relative sweeps measure motion from), then the static
   * geometry by group name order (each group's name, shape count and shapes' numbers). The same on every platform for
   * the same world, whatever order its units came in. Allocation-free.
   */
  readonly digest: (hash: number) => number;
}

/** A memory world: a class for fast properties, its functions arrow fields so they work detached. */
class World<Unit> implements MemoryWorld<Unit> {
  readonly bounds: Box;
  extensions: readonly string[] = Object.freeze([]);
  readonly isPositionClear: (p: Vec2, radius: number) => boolean;
  readonly lineClear: (from: Vec2, to: Vec2, radius?: number) => boolean;
  readonly clamp: (p: Vec2, radius?: number) => Vec2;
  readonly moveBody: (from: Vec2, to: Vec2, radius: number) => BodyMove;
  readonly pickPoint: (pick: PointPick) => Vec2 | undefined;
  readonly #table: UnitTable<Unit>;
  readonly #index: PointIndex;
  readonly #canTarget: TargetRule<Unit> | undefined;
  readonly #canTargetSide: SideTargetRule<Unit> | undefined;

  /** A selector and a selection per nesting level: a filter or `canTarget` may query the world again. */
  readonly #levels: SearchParts<Unit>[] = [];
  #depth = 0;
  #maxRadius = 0;
  #maxMotion = 0;
  readonly #dt: number;
  readonly #reaction: ReactionRule;
  readonly #statics: StaticGeometry;

  constructor(options: MemoryWorldOptions<Unit>) {
    this.#statics = new StaticGeometry(options.statics ?? []);
    this.#table = new UnitTable<Unit>(options.idOf, options.slots);

    const placement = new Placement(options.bounds, this.#statics);

    this.bounds = options.bounds;
    this.#dt = options.dt ?? 1;
    this.#index =
      options.index === 'kd'
        ? new KdIndex(this.#table)
        : new GridIndex(this.#table, { bounds: options.bounds, cell: options.cell ?? 4 });
    this.#reaction = options.reaction ?? bySides;
    this.#canTarget = options.canTarget;
    this.#canTargetSide = options.canTargetSide;
    this.isPositionClear = placement.isPositionClear;
    this.lineClear = placement.lineClear;
    this.clamp = placement.clamp;
    this.moveBody = placement.moveBody;
    this.pickPoint = placement.pickPoint;
  }

  get size(): number {
    return this.#table.size;
  }

  readonly has = (unit: Unit): boolean => this.#table.find(unit) >= 0;

  readonly add = (unit: Unit, spec: UnitSpec): void => {
    const slot = this.#table.add(unit, spec);

    this.#maxRadius = Math.max(this.#maxRadius, spec.radius ?? 0);
    this.#index.insert(slot);
  };

  readonly remove = (unit: Unit): boolean => {
    const slot = this.#table.remove(unit);

    if (slot >= 0) {
      this.#index.remove(slot);
    }

    return slot >= 0;
  };

  readonly place = (unit: Unit, at: Vec2): void => {
    const table = this.#table;
    const slot = table.slotOf(unit);
    const motion = hypot(at.x - (table.px[slot] ?? 0), at.z - (table.pz[slot] ?? 0));

    // The previous position was checked as it was written, so a position that is not finite makes the motion so too.
    if (!(motion < Number.POSITIVE_INFINITY)) {
      checkPosition(at, table.id[slot] ?? -1);
    }

    table.x[slot] = at.x;
    table.z[slot] = at.z;
    this.#maxMotion = Math.max(this.#maxMotion, motion);
    this.#index.move(slot);
  };

  readonly teleport = (unit: Unit, at: Vec2): void => {
    const table = this.#table;
    const slot = table.slotOf(unit);

    checkPosition(at, table.id[slot] ?? -1);
    table.x[slot] = table.px[slot] = at.x;
    table.z[slot] = table.pz[slot] = at.z;
    // Keep the tick's conservative motion bound: other units may still have moved.
    this.#index.move(slot);
  };

  readonly tick = (): void => {
    const table = this.#table;

    table.px.set(table.x);
    table.pz.set(table.z);
    this.#maxMotion = 0;
  };

  readonly digest = (hash: number): number => {
    const table = this.#table;
    const { ordered } = table;
    let next = digest(hash, table.size);

    for (let i = 0; i < table.size; i++) {
      const slot = ordered[i] ?? -1;

      next = digest(next, table.id[slot] ?? Number.NaN);
      next = digest(next, table.x[slot] ?? Number.NaN);
      next = digest(next, table.z[slot] ?? Number.NaN);
      next = digest(next, table.radius[slot] ?? Number.NaN);
      next = digest(next, table.side[slot] ?? Number.NaN);
      next = digest(next, table.px[slot] ?? Number.NaN);
      next = digest(next, table.pz[slot] ?? Number.NaN);
    }

    return digest(next, this.#statics.digest);
  };

  readonly positionOf = (unit: Unit, out: MutableVec2): Vec2 => {
    const slot = this.#table.slotOf(unit);

    out.x = this.#table.x[slot] ?? 0;
    out.z = this.#table.z[slot] ?? 0;

    return out;
  };

  readonly previousOf = (unit: Unit, out: MutableVec2): Vec2 => {
    const slot = this.#table.slotOf(unit);

    out.x = this.#table.px[slot] ?? 0;
    out.z = this.#table.pz[slot] ?? 0;

    return out;
  };

  readonly velocityOf = (unit: Unit, out: MutableVec2): Vec2 => {
    const table = this.#table;
    const slot = table.slotOf(unit);

    out.x = ((table.x[slot] ?? 0) - (table.px[slot] ?? 0)) / this.#dt;
    out.z = ((table.z[slot] ?? 0) - (table.pz[slot] ?? 0)) / this.#dt;

    return out;
  };

  readonly radiusOf = (unit: Unit): number => this.#table.radius[this.#table.slotOf(unit)] ?? 0;
  readonly sideOf = (unit: Unit): number => this.#table.side[this.#table.slotOf(unit)] ?? 0;
  readonly reactionOf = (a: Unit, b: Unit): Reaction => this.#reaction(this.sideOf(a), this.sideOf(b));

  readonly setStatics = (shapes: readonly StaticShape[], group = ''): void => {
    this.#statics.set(shapes, group);
  };

  readonly setSide = (unit: Unit, side: number): void => {
    this.#table.side[this.#table.slotOf(unit)] = side;
  };
  readonly idOf = (unit: Unit): number => this.#table.id[this.#table.slotOf(unit)] ?? 0;

  readonly inside = (shape: Shape, options: QueryOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { selector, selection } = this.#enter();

    try {
      return selector.write(selection.over(shape, options), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly all = (options: QueryOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { selector, selection } = this.#enter();

    try {
      return selector.write(selection.over(undefined, options), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly count = (shape: Shape | undefined, options: QueryOptions<Unit>): number => {
    const { selector, selection } = this.#enter();

    try {
      return selector.count(selection.over(shape, options));
    } finally {
      this.#depth -= 1;
    }
  };

  readonly nearest = (from: Vec2, options: RangeOptions<Unit>, out: (Unit | undefined)[]): number => {
    const { selector, selection } = this.#enter();

    try {
      return selector.write(selection.around(from, options), out);
    } finally {
      this.#depth -= 1;
    }
  };

  readonly sweep = (from: Vec2, to: Vec2, options: SweepOptions<Unit>, out: (Unit | undefined)[]): number => {
    const parts = this.#enter();

    try {
      parts.selection.along(from, to, options);

      return sweep(parts, options, out);
    } finally {
      this.#depth -= 1;
    }
  };

  /** Takes the next nesting level's selector and selection, brought up to the world's reach; `#depth -= 1` gives it back. */
  #enter(): SearchParts<Unit> {
    const parts = (this.#levels[this.#depth] ??= {
      table: this.#table,
      selector: new Selector(this.#table, this.#index, {
        reaction: this.#reaction,
        canTarget: this.#canTarget,
        canTargetSide: this.#canTargetSide
      }),
      selection: new Selection<Unit>()
    });

    parts.selector.maxRadius = this.#maxRadius;
    parts.selector.maxMotion = this.#maxMotion;
    this.#depth += 1;

    return parts;
  }
}

/** The game's own query extensions: named functions over the world. */
export type QueryExtensions = Readonly<Record<string, (...args: never[]) => unknown>>;

/** `createMemoryWorld`'s two forms: without extensions, and with the game's own. */
export interface CreateMemoryWorld {
  /** A memory world with the framework's queries only. */
  <Unit>(options: MemoryWorldOptions<Unit>): MemoryWorld<Unit>;

  /** A memory world with the game's own query extensions, made over it. */
  <Unit, Ext extends QueryExtensions>(
    options: MemoryWorldOptions<Unit>,
    extend: (world: MemoryWorld<Unit>) => Ext
  ): MemoryWorld<Unit> & Ext;
}

/** Whether a world carries every extension it was given (all of none, when it was given none). */
const isExtended = <Unit, Ext extends QueryExtensions>(
  world: MemoryWorld<Unit>,
  ext: Ext | undefined
): world is MemoryWorld<Unit> & Ext =>
  ext === undefined || Object.keys(ext).every((name) => Object.hasOwn(world, name));

/**
 * Creates a memory world: `createMemoryWorld<Unit>({ bounds })`, or with the game's own query extensions
 * (`WorldQuery & GameQuery`: a passage search, a site reservation), made over the world and listed by name in its
 * `extensions` for the escape report: `createMemoryWorld({ bounds }, (world) => ({ squareClear: … }))`.
 */
export const createMemoryWorld: CreateMemoryWorld = <Unit, Ext extends QueryExtensions>(
  options: MemoryWorldOptions<Unit>,
  extend?: (world: MemoryWorld<Unit>) => Ext
): MemoryWorld<Unit> & Ext => {
  const world = new World<Unit>(options);
  const ext = extend?.(world);

  if (ext !== undefined) {
    const names = Object.keys(ext);

    if (names.some((name) => name in world)) {
      throw new RangeError(`A query extension may not replace a world query: ${names.join(', ')}.`);
    }

    Object.assign(world, ext);
    world.extensions = Object.freeze(names);
  }

  if (!isExtended(world, ext)) {
    throw new TypeError('A query extension was lost.');
  }

  return Object.freeze(world);
};
