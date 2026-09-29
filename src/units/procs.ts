import {
  type ChanceOption,
  PROC_LANDED,
  PROC_SKIPPED,
  type ProcKindDef,
  type ProcShape,
  type ProcTarget,
} from '../procs/index.ts';
import type { UnitTypes } from './unit-types.ts';

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

/** The unit system's procs, as a union: a game adds them to its proc union (`gameProc`). */
export type UnitProcs<G extends UnitTypes> = ReviveProc<G>;

/** The unit system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...units.procKinds })`. */
export interface UnitProcKinds<G extends UnitTypes> {
  /** Revives a unit. */
  readonly revive: ProcKindDef<ReviveProc<G>, G>;
}

/** A `revive` proc: `revive()`, `revive({ health: 30, to: 'eventUnit' })`. */
export const revive = <G extends UnitTypes = UnitTypes>(
  options: ChanceOption & Omit<ReviveProc<G>, 'kind' | 'chance'> = {},
): ReviveProc<G> => ({ ...options, kind: 'revive' });

/** Builds the unit system's proc kinds over its revive. */
export const createUnitProcKinds = <G extends UnitTypes>(
  reviveUnit: (unit: G['bearer'], health?: number) => boolean,
): UnitProcKinds<G> =>
  Object.freeze({
    revive: {
      targetOf: (proc) => proc.to,

      apply: (proc, _ctx, unit) => (unit !== undefined && reviveUnit(unit, proc.health) ? PROC_LANDED : PROC_SKIPPED),

      prepare: (proc) => {
        if (proc.health !== undefined && !(proc.health > 0 && Number.isFinite(proc.health))) {
          throw new RangeError(`a revive proc's health is a finite number above 0; got ${proc.health}.`);
        }

        return proc;
      },
    },
  } satisfies UnitProcKinds<G>);
