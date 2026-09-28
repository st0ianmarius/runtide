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

/** The procs that follow one proc (`ProcKindDef.follow`), the unit it landed on, and its outcome. */
interface FollowUp<G extends ProcTypes> {
  /** The procs that follow. */
  readonly procs: readonly Proc<G>[];

  /** The unit the proc landed on: the follow-ups' target. */
  readonly unit: G['bearer'];

  /** What the proc did. */
  readonly outcome: ProcOutcome;
}

/**
 * Applies the procs that follow one in the same list, aimed at the unit it landed on, and returns its outcome as it was
 * before they ran (in the frame's reused outcome, since a follow-up may reuse the one the proc returned).
 */
const followUp = <G extends ProcTypes>(apply: Applier<G>, frame: ProcFrame<G>, next: FollowUp<G>): ProcOutcome => {
  const { status, amount, hasKilled } = next.outcome;
  const target = frame.target;

  frame.target = next.unit;

  try {
    for (let i = 0; i < next.procs.length; i++) {
      const proc = next.procs[i];

      if (proc !== undefined) {
        apply(frame, proc);
      }
    }
  } finally {
    frame.target = target;
  }

  return frame.settle(status, { amount, hasKilled });
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

    const def = kinds.defs[kinds.kindOf(proc)];
    const outcome = def?.apply(proc, frame, unit) ?? PROC_LANDED;

    if (outcome.hasKilled) {
      frame.noteKill(unit);
    }

    const procs = def?.follow?.(proc, outcome);

    return procs === undefined || procs.length === 0 ? outcome : followUp(applyIn, frame, { procs, unit, outcome });
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
