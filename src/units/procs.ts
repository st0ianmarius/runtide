import type { Vec2 } from '../math/index.ts';
import type { ChanceOption, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * Revives the unit it lands on (§II.6 P3, U3): a downed or dead unit stands again, at a health or at its maximum. The
 * completion of a revive channel returns it beside `setHealth` and an invulnerability. `skipped` for a unit that
 * cannot be revived (standing, disconnected, despawned).
 */
export interface ReviveProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'revive';

  /** Whom; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** The health it stands with, capped at its maximum; its maximum when absent. */
  readonly health?: number;
}

/** Where a summon stands around its owner (§II.6 C8): a point picked in an annulus, clear of walls, in a few tries. */
export interface SummonPlacement {
  /** The nearest it stands to its owner; 0 when absent. */
  readonly min?: number;

  /** The farthest it stands. */
  readonly max: number;

  /** The room it needs at the point; none when absent. */
  readonly clearance?: number;

  /** How many points are tried; 8 when absent. */
  readonly attempts?: number;
}

/**
 * Summons units (§II.6 P3, C8, §I.7.1 F18): spawns `count` units of a template owned by the unit it lands on (the
 * list's self by default), on its side, credited to it, held by the cast whose procs are running (§II.6 S6), and
 * despawned with it unless `isBound` is false. Each stands at `at`, `atOf`'s point, or a point picked `around` its
 * owner, which the `spawned` event hands the game's world. Its amount is how many it summoned.
 */
export interface SummonProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'summon';

  /** The template: its name in data, its id in code. */
  readonly unit: G['unitName'] | UnitId;

  /** How many; 1 when absent. */
  readonly count?: number;

  /** Reads how many when the proc applies (a raise sized by missing health), in place of `count`. */
  readonly countOf?: (ctx: ProcContext<G>) => number;

  /** The owner; the list's self when absent. */
  readonly by?: ProcTarget<G>;

  /** The point they stand at. */
  readonly at?: Vec2;

  /** Reads the point when the proc applies, in place of `at`. */
  readonly atOf?: (ctx: ProcContext<G>) => Vec2 | undefined;

  /** A point picked around the owner for each, through the unit system's world; in place of `at`. */
  readonly around?: SummonPlacement;

  /** Their own base stats, over their template's (spawned at another wave's numbers). */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Stats they inherit: each a share of the owner's total, snapshotted at the summon, over `stats`. */
  readonly inherit?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Whether they despawn with their owner; true when absent. */
  readonly isBound?: boolean;
}

/** Despawns the unit it lands on (§II.6 P3 `despawn(reason)`): removed without dying; `skipped` when already gone. */
export interface DespawnProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'despawn';

  /** Whom; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** Why, for the `despawned` event; `despawn` when absent. */
  readonly reason?: string;
}

/**
 * Despawns the summons of the unit it lands on (§II.6 C8: an add list despawned with a phase), those of a template or
 * every one, in the order they spawned. Its amount is how many; `skipped` for none.
 */
export interface DespawnSummonsProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'despawnSummons';

  /** Whose; the list's self when absent. */
  readonly of?: ProcTarget<G>;

  /** Only summons of this template; every one when absent. */
  readonly unit?: G['unitName'] | UnitId;

  /** Why, for the `despawned` event; `owner` when absent. */
  readonly reason?: string;
}

/** The unit system's procs, as a union: a game adds them to its proc union (`gameProc`). */
export type UnitProcs<G extends UnitTypes> = ReviveProc<G> | SummonProc<G> | DespawnProc<G> | DespawnSummonsProc<G>;

/** The unit system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...units.procKinds })`. */
export interface UnitProcKinds<G extends UnitTypes> {
  /** Revives a unit. */
  readonly revive: ProcKindDef<ReviveProc<G>, G>;

  /** Summons units. */
  readonly summon: ProcKindDef<SummonProc<G>, G>;

  /** Despawns a unit. */
  readonly despawn: ProcKindDef<DespawnProc<G>, G>;

  /** Despawns a unit's summons. */
  readonly despawnSummons: ProcKindDef<DespawnSummonsProc<G>, G>;
}

/** A `revive` proc: `revive()`, `revive({ health: 30, to: 'eventUnit' })`. */
export const revive = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<ReviveProc<G>, 'kind' | 'chance'> = {},
): ReviveProc<G> => ({ ...options, kind: 'revive' });

/** A `summon` proc: `summon('skeleton', { count: 3, around: { min: 2, max: 4, clearance: 0.5 } })`. */
export const summon = <G extends UnitTypes = UnitTypes>(
  unit: G['unitName'] | UnitId,
  options: ChanceOption & Omit<SummonProc<G>, 'kind' | 'unit' | 'chance'> = {},
): SummonProc<G> => ({ ...options, kind: 'summon', unit });

/** A `despawn` proc: `despawn({ to: 'self', reason: 'expired' })`. */
export const despawn = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<DespawnProc<G>, 'kind' | 'chance'> = {},
): DespawnProc<G> => ({ ...options, kind: 'despawn' });

/** A `despawnSummons` proc: `despawnSummons({ unit: 'skeleton' })`. */
export const despawnSummons = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<DespawnSummonsProc<G>, 'kind' | 'chance'> = {},
): DespawnSummonsProc<G> => ({ ...options, kind: 'despawnSummons' });
