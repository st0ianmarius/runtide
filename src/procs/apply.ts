// Hot path (§I.4.2, §I.5.4): every proc goes through here, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import type { Random } from '../core/index.ts';
import type { ProcFrame } from './frame.ts';
import type { Proc } from './proc-data.ts';
import {
  PROC_LANDED,
  PROC_SKIPPED,
  type ProcContext,
  type ProcHost,
  type ProcOutcome,
  type ProcTarget,
  type ProcTypes,
} from './proc-types.ts';
import type { ProcRegistry } from './registry.ts';

/** What applying a proc reads from its system's options. */
interface ApplyParts<G extends ProcTypes> {
  /** The proc kinds. */
  readonly kinds: ProcRegistry<G>;

  /** The host, for `party`. */
  readonly host: ProcHost<G>;

  /** The procs' own stream. */
  readonly random?: Random | undefined;

  /** The game's own chance rule. */
  readonly rollChance?: ((chance: number, ctx: ProcContext<G>) => boolean) | undefined;
}

/** Applies one proc within a frame's list. */
type Applier<G extends ProcTypes> = (frame: ProcFrame<G>, proc: Proc<G>) => ProcOutcome;

/** Throws: a feature a proc needs is missing from its system. */
export const missing = (what: string): never => {
  throw new TypeError(`This proc needs ${what}, which the proc system was not given.`);
};

/** Resolves a target other than `party` (a unit passes through); `undefined` when the list has no such unit. */
const unitOf = <G extends ProcTypes>(frame: ProcFrame<G>, to: ProcTarget<G>): G['bearer'] | undefined => {
  if (to === 'self') {
    return frame.self;
  }

  if (to === 'target') {
    return frame.target;
  }

  if (to === 'eventUnit') {
    return frame.eventUnit;
  }

  return typeof to === 'string' ? undefined : to;
};

/**
 * Builds how one proc applies within a list: its chance (always-procs roll nothing; `0 < chance < 1` rolls once on
 * the procs' own stream or the game's rule), its target (a `party` fanned out in order, a unit the list killed
 * skipped), then its kind's `apply`, dispatched on the kind's id.
 */
export const createApplier = <G extends ProcTypes>(parts: ApplyParts<G>): Applier<G> => {
  const { kinds, rollChance } = parts;

  const goesOff = (chance: number | undefined, frame: ProcFrame<G>): boolean => {
    if (chance === undefined || chance >= 1) {
      return true;
    }

    if (!(chance > 0)) {
      return false;
    }

    return rollChance === undefined
      ? (parts.random ?? missing('a random stream'))() < chance
      : rollChance(chance, frame);
  };

  const applyTo = (frame: ProcFrame<G>, proc: Proc<G>, unit: G['bearer']): ProcOutcome => {
    if (frame.hasKilled(unit)) {
      return PROC_SKIPPED;
    }

    const outcome = kinds.defs[kinds.kindOf(proc)]?.apply(proc, frame, unit) ?? PROC_LANDED;

    if (outcome.hasKilled) {
      frame.noteKill(unit);
    }

    return outcome;
  };

  const toParty = (frame: ProcFrame<G>, proc: Proc<G>): ProcOutcome => {
    const members = (parts.host.party ?? missing('host.party'))(frame.self);
    let last = PROC_SKIPPED;

    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      if (member !== undefined) {
        last = applyTo(frame, proc, member);
      }
    }

    return last;
  };

  const applyIn = (frame: ProcFrame<G>, proc: Proc<G>): ProcOutcome => {
    if (!goesOff(proc.chance, frame)) {
      return PROC_SKIPPED;
    }

    const id = kinds.kindOf(proc);
    const def = kinds.defs[id];

    if (def === undefined || kinds.isTargeted[id] !== 1) {
      return def?.apply(proc, frame, undefined) ?? PROC_LANDED;
    }

    const to = def.targetOf?.(proc) ?? 'target';

    if (to === 'party') {
      return toParty(frame, proc);
    }

    const unit = unitOf(frame, to);

    return unit === undefined ? PROC_SKIPPED : applyTo(frame, proc, unit);
  };

  return applyIn;
};
