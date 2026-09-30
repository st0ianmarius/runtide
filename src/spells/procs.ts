import type { AuraId } from '../auras/index.ts';
import type { TickSlotId } from '../core/index.ts';
import type { ChanceOption, Proc, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { SpellId, SpellTagId, SpellTypes } from './spell-types.ts';

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
  readonly to?: ProcTarget<G>;

  /** What the cast is handed; see `inputOf` for one read when it applies. */
  readonly input?: G['input'];

  /** Reads the cast's input when the proc applies (the event unit, a point); `input` when absent. */
  readonly inputOf?: (ctx: ProcContext<G>) => G['input'] | undefined;

  /** Its rank; the rank of the cast whose procs these are, else the caster's own (`host.rankOf`), when absent. */
  readonly rank?: number;

  /**
   * Its own cooldown (§II.6 P3, §I.7.1 F16: an internal cooldown on a chained or triggered cast): an aura on the
   * caster that refuses the proc while held, landed once a cast started. None when absent.
   */
  readonly cooldown?: CastCooldown<G>;
}

/** A `castSpell` proc's cooldown: an aura on the caster, for its own duration or for `seconds`. */
export interface CastCooldown<G extends SpellTypes> {
  /** The aura: its name in data, its id in code. */
  readonly aura: G['auraName'] | AuraId;

  /** Its seconds, from 0; the aura's own duration when absent. */
  readonly seconds?: number;
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

  /**
   * Whether they still land, asked of their owner (the cast's caster, else the list's self) as they fall due: a false
   * drops them unrun (Galeheart's strike lands only while its owner stands). They always land when absent.
   */
  readonly bound?: DelayBound<G>;
}

/** An `after` proc's bound: whether its owner still lets it land; declared as a method so a narrower owner fits. */
export type DelayBound<G extends SpellTypes> = {
  /** Reads the owner. */
  bivarianceHack(owner: G['bearer']): boolean;
}['bivarianceHack'];

/**
 * Rescales the clocks of the unit it lands on (§II.6 A13, P3, §I.7.1 F15): its `auto` clocks still counting in scope
 * (a spell tag, or every one), times the factor; with `clocks: 'all'` its running casts' stage time left too.
 */
export interface RescaleClocksProc<G extends SpellTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'rescaleClocks';

  /** What the time left is multiplied by, from 0. */
  readonly factor: number;

  /** The spell tag whose clocks rescale: its name in data, its id in code; every clock when absent. */
  readonly tag?: G['spellTag'] | SpellTagId;

  /** `pending` (the `auto` clocks, the default) or `all` (running casts' stages too). */
  readonly clocks?: 'pending' | 'all';

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
  options: ChanceOption & Omit<RescaleClocksProc<G>, 'kind' | 'factor' | 'chance'> = {},
): RescaleClocksProc<G> => ({ ...options, kind: 'rescaleClocks', factor });

/** A `castSpell` proc: `castSpell('stab')`, `castSpell('nova', { to: 'eventUnit', rank: 2 })`. */
export const castSpell = <G extends SpellTypes = SpellTypes>(
  spell: G['spellName'] | SpellId,
  options: Omit<CastSpellProc<G>, 'kind' | 'spell'> = {},
): CastSpellProc<G> => ({ ...options, kind: 'castSpell', spell });

/** An `after` proc: `after(0.5, [damage(…)], { from: 'due' })`. */
export const after = <G extends SpellTypes = SpellTypes>(
  seconds: number,
  procs: readonly Proc<G>[],
  options: ChanceOption & Pick<AfterProc<G>, 'from' | 'slot' | 'bound'> = {},
): AfterProc<G> => ({ ...options, kind: 'after', seconds, procs });
