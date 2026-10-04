import type { Proc } from './proc-data.ts';
import type { ProcTypes } from './proc-types.ts';
import type { ProcKindId } from './registry.ts';
import type { ProcSystem } from './system.ts';

/**
 * Where an explained proc lands: one of the symbolic targets, `unit` for a unit named in code, `none` for a kind that
 * acts on no unit.
 */
export type ProcTargetKind = 'self' | 'target' | 'eventUnit' | 'other' | 'party' | 'unit' | 'none';

/**
 * A proc explained as data: its kind's id, its odds, where it lands and its numbers, for the client to
 * phrase (a card line, a tooltip) in its own words.
 */
export interface ProcExplanation {
  /** The discriminant. */
  readonly kind: 'proc';

  /** The proc kind's id in the registry. */
  readonly proc: ProcKindId;

  /**
   * Its odds: 1 for an always-proc. Reported as written, not clamped: a prepared proc's is in (0, 1]; an unprepared
   * one's above 1 goes off always and one at 0 or below never.
   */
  readonly chance: number;

  /** Where it lands. */
  readonly to: ProcTargetKind;

  /** Its numbers by field, names resolved to ids (`aura`, `stacks`, `duration`, `amount`). */
  readonly values: Readonly<Record<string, number>>;

  /** The procs nested in it (a `group`'s), explained in order. */
  readonly procs: readonly ProcExplanation[];
}

/** No numbers. */
const NONE: Readonly<Record<string, number>> = Object.freeze({});

/** The explained form of a target. */
const targetKind = (to: unknown): ProcTargetKind => {
  if (to === 'self' || to === 'target' || to === 'eventUnit' || to === 'other' || to === 'party') {
    return to;
  }

  return to === undefined ? 'target' : 'unit';
};

/**
 * One proc of a system's kinds explained as data, nested procs included. Throws for an unknown kind or name,
 * like the proc would.
 */
export const explainProc = <G extends ProcTypes>(procs: ProcSystem<G>, proc: Proc<G>): ProcExplanation => {
  const id = procs.kinds.kindOf(proc);
  const def = procs.kinds.defs[id];
  const detail = def?.explain?.(proc, procs.resolver);
  const isTargeted = procs.kinds.isTargeted[id] === 1;

  return {
    kind: 'proc',
    proc: id,
    chance: proc.chance ?? 1,
    to: isTargeted ? targetKind(def?.targetOf?.(proc)) : 'none',
    values: detail?.values ?? NONE,
    procs: (detail?.procs ?? []).map((nested) => explainProc(procs, nested))
  };
};
