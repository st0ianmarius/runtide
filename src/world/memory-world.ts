import { type Box, hypot, type MutableVec2, type Shape, type Vec2 } from '../math/index.ts';
import { Placement } from './placement.ts';
import { GridIndex, KdIndex, type PointIndex } from './point-index.ts';
import type { BodyMove, PointPick, QueryOptions, RangeOptions, Reaction, SweepOptions, WorldQuery } from './query.ts';
import { type SearchParts, sweep } from './searches.ts';
import { Selection } from './selection.ts';
import { bySides, type ReactionRule, Selector, type TargetRule } from './selector.ts';
import { StaticGeometry, type StaticShape } from './statics.ts';
import { type UnitSpec, UnitTable } from './unit-table.ts';

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

  /** The static geometry (walls, pillars), indexed once in an R-tree. */
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

  /** Adds a unit; throws when it is already here. */
  readonly add: (unit: Unit, spec: UnitSpec) => void;

  /** Removes a unit; false when it was not here. */
  readonly remove: (unit: Unit) => boolean;

  /** Moves a unit to `at` now. */
  readonly place: (unit: Unit, at: Vec2) => void;

  /** Puts a unit on another side now (a charm, a flag for combat), which every query reads from here on. */
  readonly setSide: (unit: Unit, side: number) => void;

  /** Starts a tick: every unit's previous position becomes its current one. */
  readonly tick: () => void;
}

/** A memory world: a class for fast properties, its functions arrow fields so they work detached. */
class World<Unit> implements MemoryWorld<Unit> {
  readonly bounds: Box;
  extensions: readonly string[] = Object.freeze([]);
  readonly isPositionClear: (p: Vec2, radius: number) => boolean;
  readonly lineClear: (from: Vec2, to: Vec2, radius?: number) => boolean;
  readonly clamp: (p: Vec2, radius?: number) => Vec2;
  readonly moveBody: (segment: readonly [Vec2, Vec2], radius: number) => BodyMove;
  readonly pickPoint: (pick: PointPick) => Vec2 | undefined;
  readonly #table = new UnitTable<Unit>();
  readonly #index: PointIndex;
  readonly #selector: Selector<Unit>;
  readonly #selection = new Selection<Unit>();
  readonly #parts: SearchParts<Unit>;
  readonly #dt: number;
  readonly #reaction: ReactionRule;

  constructor(options: MemoryWorldOptions<Unit>) {
    const placement = new Placement(options.bounds, new StaticGeometry(options.statics ?? []));

    this.bounds = options.bounds;
    this.#dt = options.dt ?? 1;
    this.#index =
      options.index === 'kd'
        ? new KdIndex(this.#table)
        : new GridIndex(this.#table, { bounds: options.bounds, cell: options.cell ?? 4 });
    this.#reaction = options.reaction ?? bySides;
    this.#selector = new Selector(this.#table, this.#index, {
      reaction: this.#reaction,
      canTarget: options.canTarget,
    });
    this.#parts = { table: this.#table, selector: this.#selector, selection: this.#selection };
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

    this.#selector.maxRadius = Math.max(this.#selector.maxRadius, spec.radius ?? 0);
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

    table.x[slot] = at.x;
    table.z[slot] = at.z;
    this.#selector.maxMotion = Math.max(this.#selector.maxMotion, motion);
    this.#index.move(slot);
  };

  readonly tick = (): void => {
    const table = this.#table;

    table.px.set(table.x);
    table.pz.set(table.z);
    this.#selector.maxMotion = 0;
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

  readonly setSide = (unit: Unit, side: number): void => {
    this.#table.side[this.#table.slotOf(unit)] = side;
  };
  readonly idOf = (unit: Unit): number => this.#table.id[this.#table.slotOf(unit)] ?? 0;

  readonly inside = (shape: Shape, options: QueryOptions<Unit>, out: (Unit | undefined)[]): number =>
    this.#selector.write(this.#selection.over(shape, options), out);

  readonly all = (options: QueryOptions<Unit>, out: (Unit | undefined)[]): number =>
    this.#selector.write(this.#selection.over(undefined, options), out);

  readonly count = (shape: Shape | undefined, options: QueryOptions<Unit>): number =>
    this.#selector.count(this.#selection.over(shape, options));

  readonly nearest = (from: Vec2, options: RangeOptions<Unit>, out: (Unit | undefined)[]): number =>
    this.#selector.write(this.#selection.around(from, options), out);

  readonly sweep = (segment: readonly [Vec2, Vec2], options: SweepOptions<Unit>, out: (Unit | undefined)[]): number =>
    sweep(this.#parts, [segment, options], out);
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
    extend: (world: MemoryWorld<Unit>) => Ext,
  ): MemoryWorld<Unit> & Ext;
}

/** Whether a world carries every extension it was given (all of none, when it was given none). */
const isExtended = <Unit, Ext extends QueryExtensions>(
  world: MemoryWorld<Unit>,
  ext: Ext | undefined,
): world is MemoryWorld<Unit> & Ext =>
  ext === undefined || Object.keys(ext).every((name) => Object.hasOwn(world, name));

/**
 * Creates a memory world: `createMemoryWorld<Unit>({ bounds })`, or with the game's own query extensions
 * (`WorldQuery & GameQuery`: a passage search, a site reservation), made over the world and listed by name in its
 * `extensions` for the escape report: `createMemoryWorld({ bounds }, (world) => ({ squareClear: … }))`.
 */
export const createMemoryWorld: CreateMemoryWorld = <Unit, Ext extends QueryExtensions>(
  options: MemoryWorldOptions<Unit>,
  extend?: (world: MemoryWorld<Unit>) => Ext,
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
