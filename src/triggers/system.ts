import type { AuraId, AuraSystem } from '../auras/index.ts';
import type { EventKind, Listener, Random } from '../core/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import { compileTriggers, type TriggerConditions } from './compile.ts';
import { createDispatcher, type TriggerContext } from './dispatch.ts';
import type { TriggerEvent } from './events.ts';
import { explainCompiled, type TriggerExplanation } from './explain.ts';
import type { TriggerId } from './trigger-id.ts';
import type { TriggerTypes } from './trigger-types.ts';

/** The part of a bus triggers dispatch through: its capped handler tier (a core `Bus` is one). */
export interface TriggerBus {
  /** Adds a capped handler (run only while under the bus's depth cap); returns the function that removes it. */
  readonly handle: <Payload>(kind: EventKind<Payload>, handler: Listener<Payload>) => () => void;
}

/** What a trigger system is built from. */
export interface TriggerSystemOptions<G extends TriggerTypes, Host = never> {
  /** The aura system, whose registry holds the triggers (`AuraDef.triggers`) and their cooldown auras. */
  readonly auras: AuraSystem<G>;

  /** The proc system triggers run their `do` through; its host's `party` and `idOf` serve triggers too. */
  readonly procs: ProcSystem<G>;

  /**
   * The bus the events are raised on. Triggers dispatch through its capped tier, so its depth cap (3 by default)
   * bounds how deep triggers nest, while its subscribers still hear every event past it.
   */
  readonly bus: TriggerBus;

  /** Every trigger event, by name (`triggerEvent`, `auraTriggerEvent`). */
  readonly events: Readonly<Record<G['event'], TriggerEvent<G>>>;

  /** The game conditions triggers test on their owner, if any do. */
  readonly conditions?: TriggerConditions<G, Host>;

  /**
   * The triggers' own random stream, which their `chance` rolls on and nothing else draws from (a salted sequential
   * stream or a keyed source), so adding a trigger never shifts another system's rolls.
   */
  readonly random?: Random;

  /**
   * A game's own chance rule, in place of one draw on `random` below `chance`: a keyed roll over the
   * context, a proc-per-minute rate. Called only for a trigger whose chance is below 1, after its conditions and once
   * its cooldown is known to be over.
   */
  readonly rollChance?: (chance: number, ctx: TriggerContext<G>) => boolean;

  /**
   * A game's cooldown length from the trigger's `icd`; the `icd` when absent. Must return positive, finite seconds,
   * checked when the trigger fires because the rule reads the live context.
   */
  readonly cooldownSeconds?: (icd: number, ctx: TriggerContext<G>) => number;
}

/**
 * A trigger system: every trigger on the game's auras, compiled at load and answering the bus's
 * events through its capped tier, for the bearers that hold the auras.
 */
export interface TriggerSystem {
  /** How many triggers the auras hold. */
  readonly count: number;

  /** The event kinds some trigger answers: the only ones it listens to. */
  readonly events: readonly EventKind<unknown>[];

  /** The filter names, by filter id (what explanations carry). */
  readonly filters: readonly string[];

  /** The id of an aura's trigger, by its index there; `undefined` when it has none at that index. */
  readonly idOf: (aura: AuraId, index: number) => TriggerId | undefined;

  /** The cooldown aura of an aura's trigger; `undefined` when it has no `icd`. */
  readonly cooldownOf: (aura: AuraId, index: number) => AuraId | undefined;

  /** Stops listening to the bus. */
  readonly stop: () => void;
}

/** Each system's explainer: an aura's triggers explained, in authored order. */
const EXPLAINERS = new WeakMap<TriggerSystem, (aura: AuraId) => readonly TriggerExplanation[]>();

/**
 * An aura's triggers explained as data, in authored order: each with its address, odds, cooldown,
 * conditions and procs, for the client to phrase (a pact's card line, a buff's tooltip).
 */
export const explainTriggers = (triggers: TriggerSystem, aura: AuraId): readonly TriggerExplanation[] => {
  const explain = EXPLAINERS.get(triggers);

  if (explain === undefined) {
    throw new TypeError('explainTriggers needs a system made by createTriggerSystem.');
  }

  return explain(aura);
};

/** One trigger explained as data, by its aura and index there. Throws when the aura has no such trigger. */
export const explainTrigger = (triggers: TriggerSystem, aura: AuraId, index: number): TriggerExplanation =>
  explainTriggers(triggers, aura)[index] ??
  ((): never => {
    throw new RangeError(`Aura ${aura} has no trigger ${index}.`);
  })();

/**
 * Creates the trigger system: `createTriggerSystem({ auras, procs, bus, events: { hit: triggerEvent(…), aura:
 * auraTriggerEvent(bus.kind.aura) }, random: stream(seed, TRIGGER_SALT) })`. Compiles and validates every trigger at
 * load (one error listing every invalid one), then listens to each answered event kind on the bus's capped tier.
 */
export const createTriggerSystem = <G extends TriggerTypes, Host = never>(
  options: TriggerSystemOptions<G, Host>
): TriggerSystem => {
  const events: Readonly<Record<string, TriggerEvent<G> | undefined>> = options.events;
  const tables = compileTriggers<G, Host>({ ...options, events, conditions: options.conditions });

  const dispatch = createDispatcher<G, Host>({
    ...options,
    tables,
    conditions: options.conditions,
    random: options.random,
    rollChance: options.rollChance,
    cooldownSeconds: options.cooldownSeconds
  });

  const answered = Object.values(events).flatMap((event, slot) =>
    event !== undefined && tables.byEvent[slot] !== undefined ? [{ event, slot }] : []
  );

  const stops = answered.map(({ event, slot }) =>
    options.bus.handle(event.kind, (payload) => {
      dispatch(slot, event, payload);
    })
  );

  const system: TriggerSystem = Object.freeze({
    count: tables.triggers.length,
    events: Object.freeze([...new Set(answered.map(({ event }) => event.kind))]),
    filters: tables.filters,
    idOf: (aura: AuraId, index: number) => tables.byAura[aura]?.[index]?.id,
    cooldownOf: (aura: AuraId, index: number) => tables.byAura[aura]?.[index]?.cooldown,

    stop: () => {
      for (const stop of stops) {
        stop();
      }
    }
  });

  EXPLAINERS.set(system, (aura) =>
    (tables.byAura[aura] ?? []).map((trigger) => explainCompiled(options.procs, trigger))
  );

  return system;
};
