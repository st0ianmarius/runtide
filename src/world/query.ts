import type { Random } from '../core/index.ts';
import type { Box, Shape, Vec2 } from '../math/index.ts';

/** Which units a query keeps, relative to the unit it asks for (`of`): its foes, its allies, or every unit. */
export type QuerySide = 'foes' | 'allies' | 'all';

/**
 * One key a query orders its results by, ascending: `near` and `far` by distance from the query's point (its `from`),
 * `id` by entity id, or the game's own score of a unit (lowest first). Ties always fall to the lower entity id.
 */
export type QueryOrder<Unit> = 'near' | 'far' | 'id' | ((unit: Unit) => number);

/** Something a query can ask whether a unit belongs to: a `Set`, or any set of the game's. */
export interface UnitSet<Unit> {
  /** Whether the unit is in the set. */
  readonly has: (unit: Unit) => boolean;
}

/**
 * The options every unit query takes. Each is optional; together they cover the targeting rules
 * a game repeats across its spells, so every resolver is one call.
 */
export interface QueryOptions<Unit> {
  /** Which side to keep, relative to `of`; `all` by default. */
  readonly side?: QuerySide;

  /** The unit the side is relative to (the caster); required for `foes` and `allies`. */
  readonly of?: Unit;

  /** Distances run to a unit's centre (the default) or to the edge of its body. */
  readonly measure?: 'centre' | 'edge';

  /** Whether a range's rim counts (`d ≤ range`); by default it does not (`d < range`), as a shape's round rim. */
  readonly inclusive?: boolean;

  /** Units left out (a spell's own summons, the units a hook already hit). */
  readonly exclude?: UnitSet<Unit>;

  /** A condition a unit must meet (unbranded, not an objective, in line of sight). */
  readonly filter?: (unit: Unit) => boolean;

  /** The point `near` and `far` measure from, where the query has none of its own. */
  readonly from?: Vec2;

  /** The order of the results, one key or several compared in turn; entity id when absent. */
  readonly order?: QueryOrder<Unit> | readonly QueryOrder<Unit>[];

  /** The most results kept; all by default. */
  readonly limit?: number;
}

/** The options of a range query: a reach from the query's point, and the unit query options. */
export interface RangeOptions<Unit> extends QueryOptions<Unit> {
  /** How far from the point a unit may be. */
  readonly range: number;
}

/** The options of `densest`: the candidates within `range` of the point, each scored by the units within `radius`. */
export interface DensestOptions<Unit> extends RangeOptions<Unit> {
  /** How far around a candidate its cluster reaches. */
  readonly radius: number;

  /** The most candidates scored, taken in the query's order; all by default. */
  readonly cap?: number;
}

/** What `densest` found: its best candidate, the size of its cluster, and the cluster's centroid. Reused. */
export interface Cluster<Unit> {
  /** The candidate at the heart of the densest cluster; `undefined` when nothing was in range. */
  unit: Unit | undefined;

  /** How many units the cluster holds, the candidate included. */
  count: number;

  /** The mean position of the cluster's units (the candidate's own position for a cluster of one). */
  x: number;

  /** The mean position's z. */
  z: number;
}

/** The options of `sweep`: the moving body's radius, and whether it sweeps against the units' own motion. */
export interface SweepOptions<Unit> extends QueryOptions<Unit> {
  /** The moving body's radius; 0 by default. */
  readonly radius?: number;

  /**
   * Whether the sweep runs relative to each unit's own motion this tick (from its previous position to its current
   * one), so a missile and a runner that cross mid-tick meet; against the current positions when false (the default).
   */
  readonly relative?: boolean;

  /** Where each contact's share along the segment is written, beside the unit, if given. */
  readonly shares?: number[];
}

/** Where a body's move against static geometry stopped. */
export interface BodyMove {
  /** Where it ends: `to`, or where it first touched geometry or the world's bounds. */
  readonly position: Vec2;

  /** Whether it touched something on the way. */
  readonly hit: boolean;

  /** The share of the move it made, from 0 to 1. */
  readonly share: number;
}

/**
 * How a point is picked: samples in an annulus (and optionally an arc) around a centre, each walked back
 * toward the centre while it is not clear, filtered and scored; the best of the attempts wins.
 */
export interface PointPick {
  /** The centre sampled around. */
  readonly centre: Vec2;

  /** The inner radius of the annulus; 0 by default. */
  readonly min?: number;

  /** The outer radius of the annulus. */
  readonly max: number;

  /** The heading the arc faces; a full circle when absent. */
  readonly dir?: number;

  /** The arc's half-angle, in radians; a full circle when absent. */
  readonly half?: number;

  /** The clearance a sample needs from static geometry (`isPositionClear`); 0 by default. */
  readonly clearance?: number;

  /** A blocked sample walks back toward the centre by this much a step, up to `steps` times; none by default. */
  readonly walkBack?: {
    /** The distance per step. */
    readonly step: number;

    /** The most steps. */
    readonly steps: number;
  };

  /** A condition a sample must meet. */
  readonly filter?: (point: Vec2) => boolean;

  /** A score, highest wins (the first highest on ties); without one, the first sample that passes wins. */
  readonly score?: (point: Vec2) => number;

  /** How many samples are drawn; each draws twice. */
  readonly attempts: number;

  /** The source the samples draw from. */
  readonly random: Random;
}

/**
 * What a spell or an area trigger may ask the world: pure reads, no side effects, shared by every
 * caster, so a spell written for a hero works when a creature casts it. The game implements it over its own world, or
 * uses `createMemoryWorld`; list queries write into a caller's array from index 0 and return how many they wrote.
 */
export interface WorldQuery<Unit> {
  /** The world's bounds. */
  readonly bounds: Box;

  /** Where a unit stands now, as a new vector (never scratch). */
  readonly positionOf: (unit: Unit) => Vec2;

  /** Where a unit stood at the start of this tick, as a new vector. */
  readonly previousOf: (unit: Unit) => Vec2;

  /** A unit's velocity over the last tick, as a new vector. */
  readonly velocityOf: (unit: Unit) => Vec2;

  /** A unit's body radius. */
  readonly radiusOf: (unit: Unit) => number;

  /** A unit's side, which `isFoe` compares. */
  readonly sideOf: (unit: Unit) => number;

  /**
   * Whether two units are foes, by their sides: what a `foes` query keeps and an `allies` query leaves out. Different
   * sides are foes in the reference world, unless the game gives it its own rule (a neutral side hurt by all, a free
   * for all).
   */
  readonly isFoe: (a: Unit, b: Unit) => boolean;

  /** A unit's entity id, which orders ties. */
  readonly idOf: (unit: Unit) => number;

  /** The units `shape` covers (their centres, or their bodies when measured to the edge). */
  readonly inside: (shape: Shape, options: QueryOptions<Unit>, out: (Unit | undefined)[]) => number;

  /** Every unit that passes the options, with no shape: a world-wide filter. */
  readonly all: (options: QueryOptions<Unit>, out: (Unit | undefined)[]) => number;

  /** How many units `shape` covers (every unit when absent), with the options. */
  readonly count: (shape: Shape | undefined, options: QueryOptions<Unit>) => number;

  /** The units within `range` of `from`, nearest first unless ordered otherwise. */
  readonly nearest: (from: Vec2, options: RangeOptions<Unit>, out: (Unit | undefined)[]) => number;

  /** The candidate within `range` of `from` with the most units around it (first highest on ties), into `out`. */
  readonly densest: (from: Vec2, options: DensestOptions<Unit>, out: Cluster<Unit>) => Cluster<Unit>;

  /** The units a body moving `from → to` touches, in the order it reaches them (lower id on ties). */
  readonly sweep: (segment: readonly [Vec2, Vec2], options: SweepOptions<Unit>, out: (Unit | undefined)[]) => number;

  /** Whether nothing static stands between two points (for a body of `radius`, 0 by default). */
  readonly lineClear: (from: Vec2, to: Vec2, radius?: number) => boolean;

  /** Whether a body of `radius` at `p` is clear of static geometry and inside the bounds. */
  readonly isPositionClear: (p: Vec2, radius: number) => boolean;

  /** `p` moved inside the bounds, inset by `radius` (0 by default), as a new vector. */
  readonly clamp: (p: Vec2, radius?: number) => Vec2;

  /** Moves a body of `radius` from `from` toward `to` until it touches static geometry or the bounds. */
  readonly moveBody: (segment: readonly [Vec2, Vec2], radius: number) => BodyMove;

  /** Picks a point by sampling and scoring; `undefined` when no sample passed. */
  readonly pickPoint: (pick: PointPick) => Vec2 | undefined;

  /** The names of the game's own query extensions, for the escape report. */
  readonly extensions: readonly string[];
}
