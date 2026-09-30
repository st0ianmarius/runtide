import type { ChanceOption, ProcContext, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { SpellId } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';

/**
 * Fires a button spell by the trigger path (§II.6 S4): its own rules, cost, `applies` and `resets`, then its cast, for
 * the unit it lands on (the list's self when absent), with no slot cooldown. It lands when the ability fires and is
 * refused when its rules or cost refuse it. `castSpell` casts the same spell without its button's rules.
 */
export interface UseAbilityProc<G extends AbilityTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'useAbility';

  /** The button spell: its name in data, its id in code. */
  readonly spell: G['spellName'] | SpellId;

  /** Who fires it; the list's self when absent. */
  readonly to?: ProcTarget<G>;

  /** What its cast is handed; see `inputOf` for one read when it applies. */
  readonly input?: G['input'];

  /** Reads its cast's input when the proc applies; `input` when absent. */
  readonly inputOf?: (ctx: ProcContext<G>) => G['input'] | undefined;
}

/** The ability system's proc kinds, as a union: a game adds them to its proc union (`gameProc`). */
export type AbilityProcs<G extends AbilityTypes> = UseAbilityProc<G>;

/** The ability system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...abilities.procKinds })`. */
export interface AbilityProcKinds<G extends AbilityTypes> {
  /** Fires a button spell by the trigger path. */
  readonly useAbility: ProcKindDef<UseAbilityProc<G>, G>;
}

/** A `useAbility` proc: `useAbility('dodge')`, `useAbility('nova', { to: 'eventUnit' })`. */
export const useAbility = <G extends AbilityTypes = AbilityTypes>(
  spell: G['spellName'] | SpellId,
  options: ChanceOption & Omit<UseAbilityProc<G>, 'kind' | 'spell' | 'chance'> = {},
): UseAbilityProc<G> => ({ ...options, kind: 'useAbility', spell });
