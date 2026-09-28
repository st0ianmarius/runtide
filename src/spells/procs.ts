import type { TickSlotId } from '../core/index.ts';
import type { ChanceOption, Proc, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/**
 * Casts a spell (§II.3.6, §II.6 P3): through the whole cast order, gates included, for the unit it lands on (the
 * list's self when absent), credited to the list's source. It lands when the cast starts and is refused when the cast
 * is. Chains are this proc: a swing's release returning `castSpell('stab')`.
 */
export interface CastSpellProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'castSpell';

  /** The spell: its name in data, its id in code. */
  readonly spell: G['spellName'] | SpellId;

  /** Who casts it; the list's self when absent. */
  readonly by?: ProcTarget<G>;

  /** What the cast is handed; see `inputOf` for one read when it applies. */
  readonly input?: G['input'];

  /** Reads the cast's input when the proc applies (the event unit, a point); `input` when absent. */
  readonly inputOf?: (ctx: ProcContext<G>) => G['input'] | undefined;

  /** Its rank; the rank of the cast whose procs these are, else 1, when absent. */
  readonly rank?: number;
}

/**
 * Procs that land later (§II.3.4: the lightest area trigger, `after(seconds, procs)`), on the spell system's timing
 * wheel for their tick slot. They land for the origin they were scheduled with (self, target, event unit, credit),
 * as the procs of the cast that scheduled them, which stays alive until they land (§II.6 S6).
 */
export interface AfterProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'after';

  /** The seconds until they land, from 0. */
  readonly seconds: number;

  /** The procs. */
  readonly procs: readonly Proc<G>[];

  /**
   * What the delay counts from (§II.6 P5): `now` (the default), or `due`, the due time of the delayed list landing
   * now, so an aftershock is due at its parent's time plus its own seconds (`now` outside a landing).
   */
  readonly from?: 'now' | 'due';

  /** The tick slot they land in (`spells.stepDelayed(slot)`); the landing list's for `due`, else the first. */
  readonly slot?: TickSlotId;
}

/** The spell system's proc kinds, as a union: a game adds them to its proc union (`gameProc`). */
export type SpellProcs<G extends SpellTypes> = CastSpellProc<G> | AfterProc<G>;

/** The spell system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...spells.procKinds })`. */
export interface SpellProcKinds<G extends SpellTypes> {
  /** Casts a spell. */
  readonly castSpell: ProcKindDef<CastSpellProc<G>, G>;

  /** Procs that land later. */
  readonly after: ProcKindDef<AfterProc<G>, G>;
}

/** A `castSpell` proc: `castSpell('stab')`, `castSpell('nova', { by: 'eventUnit', rank: 2 })`. */
export const castSpell = <G extends SpellTypes = SpellTypes>(
  spell: G['spellName'] | SpellId,
  options: Omit<CastSpellProc<G>, 'kind' | 'spell'> = {},
): CastSpellProc<G> => ({ ...options, kind: 'castSpell', spell });

/** An `after` proc: `after(0.5, [damage(…)], { from: 'due' })`. */
export const after = <G extends SpellTypes = SpellTypes>(
  seconds: number,
  procs: readonly Proc<G>[],
  options: ChanceOption & Pick<AfterProc<G>, 'from' | 'slot'> = {},
): AfterProc<G> => ({ ...options, kind: 'after', seconds, procs });
