import type { TickSlotId } from '../core/index.ts';
import type {
  ChanceOption,
  Proc,
  ProcContext,
  ProcKindDef,
  ProcOrigin,
  ProcShape,
  ProcTarget
} from '../procs/index.ts';
import type { SpellId, SpellTagId, SpellTypes } from './spell-types.ts';

/**
 * Casts a spell: through the whole cast order, gates included, for the unit it lands on (the
 * list's self when absent), credited to the list's source. It lands when the cast starts and is refused when the cast
 * is. Chains are this proc: a swing's release returning `castSpell('stab')`.
 */
export interface CastSpellProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'castSpell';

  /** The spell: its name in data, its id in code. */
  readonly spell: G['spellName'] | SpellId;

  /** Who casts it; the list's self when absent. */
  readonly to?: ProcTarget<G>;

  /** What the cast is handed; see `inputOf` for one read when it applies. */
  readonly input?: G['input'];

  /** Reads the cast's input when the proc applies (the event unit, a point); `input` when absent. */
  readonly inputOf?: (ctx: ProcContext<G>) => G['input'] | undefined;

  /** Its rank; the rank of the cast whose procs these are, else the caster's own (`host.rankOf`), when absent. */
  readonly rank?: number;

  /** Skips checking and starting the spell's cooldowns, allowing a self-chain; other cast checks still apply. */
  readonly ignoreCooldown?: boolean;
}

/**
 * Procs that land later (the lightest area trigger, `after(seconds, procs)`), on the spell system's timing
 * wheel for their tick slot. They land for the origin they were scheduled with (self, target, event unit, credit),
 * as the procs of the cast that scheduled them, which stays alive until they land.
 */
export interface AfterProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'after';

  /** The seconds until they land, from 0. */
  readonly seconds: number;

  /** The procs. */
  readonly procs: readonly Proc<G>[];

  /**
   * What the delay counts from: `now` (the default), or `due`, the due time of the delayed list landing
   * now, so an aftershock is due at its parent's time plus its own seconds (`now` outside a landing).
   */
  readonly from?: 'now' | 'due';

  /** The tick slot they land in (`spells.stepDelayed(slot)`); the landing list's for `due`, else the first. */
  readonly slot?: TickSlotId;

  /**
   * Who owns this list for `bound` and withdrawal. Defaults to its parent delayed list's owner for follow-ups,
   * otherwise the cast's caster or the list's self. `self` names the scheduling list's self; `source` resolves its
   * credit through the proc host's `unitOf` (required for this selector). An absent or missing source schedules
   * nothing. Does not change targets, source credit, or cast retention.
   */
  readonly owner?: 'self' | 'source' | G['bearer'];

  /**
   * Whether they still land, asked of their captured owner as they fall due: a false
   * drops them unrun (Galeheart's strike lands only while its owner stands). They always land when absent.
   */
  readonly bound?: DelayBound<G>;
}

/** An `after` proc's bound: whether its owner still lets it land; declared as a method so a narrower owner fits. */
export type DelayBound<G extends SpellTypes> = {
  /** Reads the owner and captured origin (no live aura or event payload); pooled, so read it only during the call. */
  bivarianceHack(owner: G['bearer'], origin: ProcOrigin<G>): boolean;
}['bivarianceHack'];

/**
 * Rescales the clocks of the unit it lands on: its `auto` clocks still counting in scope
 * (a spell tag, or every one), times the factor.
 */
export interface RescaleClocksProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'rescaleClocks';

  /** What the time left is multiplied by, from 0. */
  readonly factor: number;

  /** The spell tag whose clocks rescale: its name in data, its id in code; every clock when absent. */
  readonly tag?: G['spellTag'] | SpellTagId;

  /** Whose clocks; the list's self when absent. */
  readonly to?: ProcTarget<G>;
}

/** The spell system's proc kinds, as a union: a game adds them to its proc union (`gameProc`). */
export type SpellProcs<G extends SpellTypes> = CastSpellProc<G> | AfterProc<G> | RescaleClocksProc<G>;

/** The spell system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...spells.procKinds })`. */
export interface SpellProcKinds<G extends SpellTypes> {
  /** Casts a spell. */
  readonly castSpell: ProcKindDef<CastSpellProc<G>, G>;

  /** Procs that land later. */
  readonly after: ProcKindDef<AfterProc<G>, G>;

  /** Rescales a unit's clocks. */
  readonly rescaleClocks: ProcKindDef<RescaleClocksProc<G>, G>;
}

/** A `rescaleClocks` proc: `rescaleClocks(0.5, { tag: 'attack' })` halves what is left of the attack clocks. */
export const rescaleClocks = <G extends SpellTypes = SpellTypes>(
  factor: number,
  options: ChanceOption & Omit<RescaleClocksProc<G>, 'kind' | 'factor' | 'chance'> = {}
): RescaleClocksProc<G> => ({ ...options, kind: 'rescaleClocks', factor });

/** A `castSpell` proc: `castSpell('stab')`, `castSpell('nova', { ignoreCooldown: true })` for a self-chain. */
export const castSpell = <G extends SpellTypes = SpellTypes>(
  spell: G['spellName'] | SpellId,
  options: Omit<CastSpellProc<G>, 'kind' | 'spell'> = {}
): CastSpellProc<G> => ({ ...options, kind: 'castSpell', spell });

/** An `after` proc: `after(0.5, [damage(…)], { from: 'due' })`. */
export const after = <G extends SpellTypes = SpellTypes>(
  seconds: number,
  procs: readonly Proc<G>[],
  options: ChanceOption & Pick<AfterProc<G>, 'from' | 'slot' | 'bound' | 'owner'> = {}
): AfterProc<G> => ({ ...options, kind: 'after', seconds, procs });
