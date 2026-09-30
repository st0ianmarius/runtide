import type { AuraId, AuraSystem } from '../auras/index.ts';
import {
  compileCondition,
  type CompiledCondition,
  type ConditionTable,
  conditionTest,
  type ConditionTest,
  type ValueTable
} from '../conditions/index.ts';
import { toId } from '../core/ids.ts';
import { type Bitset, createBitset, type EventKind } from '../core/index.ts';
import type { Proc, ProcSystem } from '../procs/index.ts';
import { cooldownName, triggerName } from './cooldowns.ts';
import type { TriggerContext } from './dispatch.ts';
import type { TriggerEvent, TriggerFilterSpec } from './events.ts';
import type { TriggerId } from './trigger-id.ts';
import { isTriggerDef, type TriggerCondition, type TriggerDef, type TriggerTypes } from './trigger-types.ts';

/** The game conditions a trigger system tests on owners, and the host each test reads for an owner. */
export interface TriggerConditions<G extends TriggerTypes, Host> {
  /** The game's condition table (`defineConditions`), shared with the modifiers. */
  readonly table: ConditionTable<G['condition'], Host>;

  /** The game's value kinds (`defineValues`), which comparisons read; none when absent. */
  readonly values?: ValueTable<G['valueKind'], Host>;

  /** The host a condition reads for a trigger's owner (its state, its world). */
  readonly host: (owner: G['bearer']) => Host;
}

/** One compiled `when` entry. */
export interface TriggerCheck<G extends TriggerTypes, Host> {
  /** The filter's id, or -1 for a game condition. */
  readonly filter: number;

  /** The filter's spec on this event; `undefined` when the event does not carry it (the check fails). */
  readonly spec: TriggerFilterSpec<G> | undefined;

  /** The compiled condition, for a game condition. */
  readonly condition: CompiledCondition | undefined;

  /** The condition's test (a lone test as itself, a composition as its bound tree), for a game condition. */
  readonly test: ConditionTest<Host> | undefined;

  /** The resolved argument. */
  readonly arg: number;
}

/** One trigger, compiled at load: everything dispatch reads, resolved to numbers. */
export interface CompiledTrigger<G extends TriggerTypes, Host> {
  /** Its dense id, in aura order then authored order. */
  readonly id: TriggerId;

  /** The aura it lives on. */
  readonly aura: AuraId;

  /** Its index in the aura's `triggers`. */
  readonly index: number;

  /** The bus event kind it answers. */
  readonly event: EventKind<unknown>;

  /** Whether it hears its owner's party. */
  readonly isParty: boolean;

  /** Its odds, or its rule for them; 1 for always. */
  readonly chance: number | ((ctx: TriggerContext<G>) => number);

  /** Its internal cooldown in seconds; 0 for none. */
  readonly icd: number;

  /** Its cooldown aura, when it has an `icd`. */
  readonly cooldown: AuraId | undefined;

  /** Its `when`, compiled, in order. */
  readonly checks: readonly TriggerCheck<G, Host>[];

  /** Its `do`, prepared. */
  readonly procs: readonly Proc<G>[];
}

/** Everything dispatch and explanation read, by event kind and aura id. */
export interface TriggerTables<G extends TriggerTypes, Host> {
  /** Every trigger, by id. */
  readonly triggers: readonly CompiledTrigger<G, Host>[];

  /** The triggers answering an event kind, by kind then aura id, in authored order. */
  readonly byEvent: readonly (readonly (readonly CompiledTrigger<G, Host>[] | undefined)[] | undefined)[];

  /** The aura ids with a trigger answering an event kind, by kind. */
  readonly answers: readonly (Bitset | undefined)[];

  /** The aura ids with a `party` trigger answering an event kind, by kind. */
  readonly partyAnswers: readonly (Bitset | undefined)[];

  /** Each aura's triggers, by aura id, in authored order. */
  readonly byAura: readonly (readonly CompiledTrigger<G, Host>[] | undefined)[];

  /** Every filter name the events carry, by filter id. */
  readonly filters: readonly string[];
}

/** What triggers compile against. */
export interface CompileInput<G extends TriggerTypes, Host> {
  /** The aura system, whose registry holds the triggers and their cooldown auras. */
  readonly auras: AuraSystem<G>;

  /** The proc system, which prepares every `do`. */
  readonly procs: ProcSystem<G>;

  /** The trigger events, by name. */
  readonly events: Readonly<Record<string, TriggerEvent<G> | undefined>>;

  /** The game conditions, if triggers test any. */
  readonly conditions: TriggerConditions<G, Host> | undefined;
}

/** Throws a `RangeError`. */
const refuse = (message: string): never => {
  throw new RangeError(message);
};

/** A filter's argument resolved: a number as is, a name through the filter's resolver. */
const filterArg = <G extends TriggerTypes, Host>(
  input: CompileInput<G, Host>,
  at: {
    readonly name: string;
    readonly arg: number | string | undefined;
    readonly spec: TriggerFilterSpec<G>;
  }
): number => {
  if (typeof at.arg !== 'string') {
    return at.arg ?? 0;
  }

  return at.spec.resolve?.(at.arg, input.auras.registry) ?? refuse(`filter ${at.name} takes a number.`);
};

/** The spec of a filter on any event, for resolving its argument when this event does not carry it. */
const anySpec = <G extends TriggerTypes, Host>(input: CompileInput<G, Host>, name: string): TriggerFilterSpec<G> => {
  for (const event of Object.values(input.events)) {
    const spec = event?.filters[name];

    if (spec !== undefined) {
      return spec;
    }
  }

  return refuse(`unknown filter ${name}.`);
};

/** Compiles one `when` entry. */
const compileCheck = <G extends TriggerTypes, Host>(
  input: CompileInput<G, Host>,
  at: { readonly event: TriggerEvent<G>; readonly filters: readonly string[] },
  entry: TriggerCondition<G>
): TriggerCheck<G, Host> => {
  if ('filter' in entry) {
    const spec = at.event.filters[entry.filter];

    const arg = filterArg(input, {
      name: entry.filter,
      arg: entry.arg,
      spec: spec ?? anySpec(input, entry.filter)
    });

    return {
      filter: at.filters.indexOf(entry.filter),
      spec,
      condition: undefined,
      test: undefined,
      arg
    };
  }

  const conditions = input.conditions ?? refuse('tests a condition, but the system has no conditions.');

  const tables = { conditions: conditions.table, values: conditions.values };
  const condition = compileCondition(tables, entry, 'when');
  const { test, arg } = conditionTest(tables, condition);

  return { filter: -1, spec: undefined, condition, test, arg };
};

/** Throws unless a chance is odds in (0, 1], or a function; nothing for none. */
const checkChance = (chance: unknown): void => {
  if (typeof chance === 'number' && !(chance > 0 && chance <= 1)) {
    refuse(`chance ${chance} is outside (0, 1].`);
  }

  if (chance !== undefined && typeof chance !== 'number' && typeof chance !== 'function') {
    refuse('chance is a number or a function.');
  }
};

/** Checks a trigger's numbers and shape. */
const checkNumbers = <G extends TriggerTypes>(def: TriggerDef<G>): void => {
  if (def.hears !== undefined && def.hears !== 'self' && def.hears !== 'party') {
    refuse(`hears must be self or party; got ${String(def.hears)}.`);
  }

  checkChance(def.chance);

  if (def.icd !== undefined && !(def.icd > 0 && Number.isFinite(def.icd))) {
    refuse(`icd ${def.icd} is not a positive, finite number of seconds.`);
  }

  if (def.do.length === 0) {
    refuse('does nothing (an empty do).');
  }
};

/** The cooldown aura of a trigger with an `icd`, which the registry must hold. */
const cooldownOf = <G extends TriggerTypes, Host>(input: CompileInput<G, Host>, at: TriggerAt): AuraId | undefined => {
  const name = cooldownName(at.auraName, at.index);
  const ids: Readonly<Record<string, AuraId | undefined>> = input.auras.registry.id;

  return ids[name] ?? refuse(`has an icd, but the aura registry has no ${name} (build it with withTriggerCooldowns).`);
};

/** Where a trigger sits. */
interface TriggerAt {
  /** Its dense id. */
  readonly id: number;

  /** Its aura. */
  readonly aura: AuraId;

  /** Its aura's name. */
  readonly auraName: string;

  /** Its index there. */
  readonly index: number;

  /** Every filter name, by id. */
  readonly filters: readonly string[];
}

/** Compiles and checks one trigger; throws a `RangeError` saying what is wrong. */
const compileOne = <G extends TriggerTypes, Host>(
  input: CompileInput<G, Host>,
  at: TriggerAt,
  raw: unknown
): CompiledTrigger<G, Host> => {
  const def = isTriggerDef<G>(raw) ? raw : refuse('is not a trigger (it needs on and do).');
  const event = input.events[def.on] ?? refuse(`answers ${def.on}, which is not a trigger event.`);

  checkNumbers(def);

  return {
    id: toId<'triggers'>(at.id),
    aura: at.aura,
    index: at.index,
    event: event.kind,
    isParty: def.hears === 'party',
    chance: def.chance ?? 1,
    icd: def.icd ?? 0,
    cooldown: def.icd === undefined ? undefined : cooldownOf(input, at),
    checks: (def.when ?? []).map((entry) => compileCheck(input, { event, filters: at.filters }, entry)),
    procs: input.procs.prepare(def.do, `Trigger ${triggerName(at.auraName, at.index)}`)
  };
};

/** Every filter name the events carry, in declaration order. */
const filterNames = <G extends TriggerTypes>(events: CompileInput<G, unknown>['events']): readonly string[] => [
  ...new Set(Object.values(events).flatMap((event) => Object.keys(event?.filters ?? {})))
];

/** Compiles every trigger of every aura, collecting every error before throwing them together. */
const compileAll = <G extends TriggerTypes, Host>(
  input: CompileInput<G, Host>,
  filters: readonly string[]
): CompiledTrigger<G, Host>[] => {
  const { registry } = input.auras;
  const triggers: CompiledTrigger<G, Host>[] = [];
  const errors: string[] = [];

  for (const aura of registry.ids) {
    const list: readonly unknown[] = registry.get(aura).triggers ?? [];

    for (const [index, raw] of list.entries()) {
      const auraName = registry.name(aura);
      const at = { id: triggers.length, aura, auraName, index, filters };

      try {
        triggers.push(compileOne(input, at, raw));
      } catch (error: unknown) {
        const prefix = `Trigger ${triggerName(auraName, index)}`;
        const message = error instanceof Error ? error.message : String(error);

        errors.push(message.startsWith(prefix) ? message : `${prefix}: ${message}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new RangeError(`Invalid triggers:\n${errors.join('\n')}`);
  }

  return triggers;
};

/** Groups triggers by event kind, then by aura id. */
const byEventOf = <G extends TriggerTypes, Host>(
  triggers: readonly CompiledTrigger<G, Host>[]
): CompiledTrigger<G, Host>[][][] => {
  const byEvent: CompiledTrigger<G, Host>[][][] = [];

  for (const trigger of triggers) {
    const byAura = (byEvent[trigger.event] ??= []);

    (byAura[trigger.aura] ??= []).push(trigger);
  }

  return byEvent;
};

/** The aura ids that have a trigger for each event kind, all or `party` ones only. */
const answersOf = <G extends TriggerTypes, Host>(
  byEvent: readonly (readonly (readonly CompiledTrigger<G, Host>[] | undefined)[] | undefined)[],
  isPartyOnly: boolean
): (Bitset | undefined)[] =>
  Array.from(byEvent, (byAura) =>
    byAura === undefined
      ? undefined
      : createBitset(
          byAura.flatMap((list, aura) =>
            list?.some((trigger) => !isPartyOnly || trigger.isParty) === true ? [aura] : []
          )
        )
  );

/**
 * Compiles every trigger on the registry's auras at load: validated (odds in (0, 1], a positive
 * finite `icd` with its cooldown aura, a non-empty `do`, known events, filters, conditions and proc names), resolved to
 * numbers, and indexed by event kind and aura id. Throws one `RangeError` listing every invalid trigger.
 */
export const compileTriggers = <G extends TriggerTypes, Host>(input: CompileInput<G, Host>): TriggerTables<G, Host> => {
  const filters = filterNames(input.events);
  const triggers = compileAll(input, filters);
  const byEvent = byEventOf(triggers);
  const byAura: CompiledTrigger<G, Host>[][] = [];

  for (const trigger of triggers) {
    (byAura[trigger.aura] ??= []).push(trigger);
  }

  return {
    triggers,
    byEvent,
    answers: answersOf(byEvent, false),
    partyAnswers: answersOf(byEvent, true),
    byAura,
    filters
  };
};
