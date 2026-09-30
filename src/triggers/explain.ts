import type { AuraId } from '../auras/index.ts';
import type { CompiledCondition } from '../conditions/index.ts';
import type { EventKind } from '../core/index.ts';
import { explainProc, type ProcExplanation, type ProcSystem } from '../procs/index.ts';
import type { CompiledTrigger, TriggerCheck } from './compile.ts';
import type { TriggerId } from './trigger-id.ts';
import type { TriggerTypes } from './trigger-types.ts';

/** A game condition a trigger tests on its owner, explained. */
export interface TriggerConditionExplanation {
  /** The discriminant. */
  readonly kind: 'condition';

  /** The condition, compiled: game tests and value kinds by id, with their arguments and composition. */
  readonly condition: CompiledCondition;
}

/** An event filter a trigger tests, explained. */
export interface TriggerFilterExplanation {
  /** The discriminant. */
  readonly kind: 'filter';

  /** The filter's id (its position in the trigger system's `filters`). */
  readonly filter: number;

  /** Its resolved argument. */
  readonly arg: number;

  /** Whether the answered event carries it; a filter it does not carry always fails. */
  readonly isCarried: boolean;
}

/**
 * A trigger explained as data: its address (the aura and its index there, for the client's text overrides,
 *), what it answers and whose events it hears, its odds and cooldown, its conditions and its procs, with
 * every number the simulation uses, for the client to phrase.
 */
export interface TriggerExplanation {
  /** The discriminant. */
  readonly kind: 'trigger';

  /** Its id. */
  readonly trigger: TriggerId;

  /** The aura it lives on. */
  readonly aura: AuraId;

  /** Its index in that aura's `triggers`. */
  readonly index: number;

  /** The event kind it answers. */
  readonly event: EventKind<unknown>;

  /** Whose events it hears. */
  readonly hears: 'self' | 'party';

  /** Its odds: 1 for always. */
  readonly chance: number;

  /** Its internal cooldown in seconds; 0 for none. */
  readonly icd: number;

  /** Its cooldown aura, when it has an `icd`. */
  readonly cooldown: AuraId | undefined;

  /** Its conditions and filters, in order. */
  readonly when: readonly (TriggerConditionExplanation | TriggerFilterExplanation)[];

  /** Its procs, in order. */
  readonly do: readonly ProcExplanation[];
}

/** One `when` entry explained. */
const explainCheck = <G extends TriggerTypes, Host>(
  check: TriggerCheck<G, Host>,
): TriggerConditionExplanation | TriggerFilterExplanation => {
  if (check.condition !== undefined) {
    return { kind: 'condition', condition: check.condition };
  }

  return { kind: 'filter', filter: check.filter, arg: check.arg, isCarried: check.spec !== undefined };
};

/** A compiled trigger explained. */
export const explainCompiled = <G extends TriggerTypes, Host>(
  procs: ProcSystem<G>,
  trigger: CompiledTrigger<G, Host>,
): TriggerExplanation => ({
  kind: 'trigger',
  trigger: trigger.id,
  aura: trigger.aura,
  index: trigger.index,
  event: trigger.event,
  hears: trigger.isParty ? 'party' : 'self',
  chance: trigger.chance,
  icd: trigger.icd,
  cooldown: trigger.cooldown,
  when: trigger.checks.map(explainCheck),
  do: trigger.procs.map((proc) => explainProc(procs, proc)),
});
