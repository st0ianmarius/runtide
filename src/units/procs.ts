import type { Vec2 } from '../math/index.ts';
import type { ChanceOption, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { UnitId, UnitTypes } from './unit-types.ts';

/**
 * Revives the unit it lands on: a dead unit lives again, at a health, a share of its maximum, or its maximum. `skipped`
 * for a unit that is alive or despawned. A downed hero is a dead unit (all its leave-life cleanup ran), so this stands
 * it back up. Landed when the revive was made, or queued behind a lifecycle move of the unit running now (a revive from
 * its death's `onState`), which runs once that move is done and may still be refused then.
 */
export interface ReviveProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'revive';

  /** Whom; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /**
   * The health it stands with, capped at its maximum, or a share of its maximum (`{ share: 0.3 }`, read as the proc
   * lands); its maximum when absent.
   */
  readonly health?:
    | number
    | {
        /** The share of its maximum health, above 0. */
        readonly share: number;
      };
}

/**
 * Summons units: spawns `count` units of a template owned by the unit it lands on (the
 * list's self by default), on its side, credited to it, held by the cast whose procs are running, and
 * despawned with it unless `isBound` is false. Each stands at `at` or `atOf`'s point (a game picks one around the owner
 * with its world's `pickPoint`), which the `spawned` event hands the game's world. Its amount is how many it summoned.
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
  readonly to?: ProcTarget<G>;

  /** The point they stand at. */
  readonly at?: Vec2;

  /** Reads each summon's point when the proc applies, in place of `at`. */
  readonly atOf?: (ctx: ProcContext<G>) => Vec2 | undefined;

  /**
   * What a summon does when `atOf` finds no point: `skip` that one and go on to the next, or `stop` the summon there;
   * `skip` when absent.
   */
  readonly onNoPoint?: 'skip' | 'stop';

  /** The game's data each summon spawns with (`SpawnUnit.data`: a wave index, the summoner). */
  readonly data?: G['spawnData'];

  /** Reads the data when each summon spawns, in place of `data`. */
  readonly dataOf?: (ctx: ProcContext<G>) => G['spawnData'];

  /** Their own base stats, over their template's (spawned at another wave's numbers). */
  readonly stats?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Stats they inherit: each a share of the owner's total, snapshotted at the summon, over `stats`. */
  readonly inherit?: Readonly<Partial<Record<G['stat'], number>>>;

  /** Whether they despawn with their owner; true when absent. */
  readonly isBound?: boolean;

  /** Their side (a turned add fighting for the heroes, a boss's hazard that hurts everyone); the owner's when absent. */
  readonly side?: number;

  /**
   * How many of the template the owner may keep at once: a summon past it ends the owner's oldest of the template (it
   * despawns, reason `replaced`: a sentry replacing the last), or is refused (`refuse`: a cap of six adds).
   */
  readonly limit?: {
    /** The most at once, from 1. */
    readonly perOwner: number;

    /** What a summon past the limit does; `oldest` when absent. */
    readonly replace?: 'oldest' | 'refuse';
  };
}

/** Despawns the unit it lands on: removed without dying; `skipped` when already gone. */
export interface DespawnProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'despawn';

  /** Whom; the list's target when absent. */
  readonly to?: ProcTarget<G>;

  /** Why, for the `despawned` event; `despawn` when absent. */
  readonly reason?: string;
}

/**
 * Despawns the summons of the unit it lands on (an add list despawned with a phase), those of a template or
 * every one, in the order they spawned. Its amount is how many; `skipped` for none.
 */
export interface DespawnSummonsProc<G extends UnitTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'despawnSummons';

  /** Whose; the list's self when absent. */
  readonly to?: ProcTarget<G>;

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

/** A `revive` proc: `revive()`, `revive({ health: 30, to: 'eventUnit' })`, `revive({ health: { share: 0.3 } })`. */
export const revive = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<ReviveProc<G>, 'kind' | 'chance'> = {}
): ReviveProc<G> => ({ ...options, kind: 'revive' });

/** A `summon` proc: `summon('skeleton', { count: 3, atOf: (ctx) => ringAround(ctx.self) })`. */
export const summon = <G extends UnitTypes = UnitTypes>(
  unit: G['unitName'] | UnitId,
  options: ChanceOption & Omit<SummonProc<G>, 'kind' | 'unit' | 'chance'> = {}
): SummonProc<G> => ({ ...options, kind: 'summon', unit });

/** A `despawn` proc: `despawn({ to: 'self', reason: 'expired' })`. */
export const despawn = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<DespawnProc<G>, 'kind' | 'chance'> = {}
): DespawnProc<G> => ({ ...options, kind: 'despawn' });

/** A `despawnSummons` proc: `despawnSummons({ unit: 'skeleton' })`. */
export const despawnSummons = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<DespawnSummonsProc<G>, 'kind' | 'chance'> = {}
): DespawnSummonsProc<G> => ({ ...options, kind: 'despawnSummons' });
