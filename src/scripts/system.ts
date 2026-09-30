import type { AiSystem, TimerId } from '../ai/index.ts';
import type { EventKind } from '../core/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { UnitScripts } from '../units/index.ts';
import type { ScriptRegistry } from './define-scripts.ts';
import { ScriptRecord } from './record.ts';
import { noScript, ScriptRunner } from './runner.ts';
import type { AnyBehaviour, Behaviour, ScriptEventName, ScriptId, ScriptTypes } from './script-types.ts';

/** One game event behaviours handle: its bus kind, and the unit it is delivered to. */
export interface ScriptEventBinding<G extends ScriptTypes, Payload> {
  /** Its kind on the bus. */
  readonly kind: EventKind<Payload>;

  /**
   * The unit it goes to: the blow's target, the cast's caster, a dead add's owner; `undefined` delivers it to no one.
   * A unit with no script, or none of whose behaviours handle it, costs one field read.
   */
  unitOf(this: void, payload: Payload): G['bearer'] | undefined;
}

/** The bus a script system subscribes to its bound events on (a core bus). */
export interface ScriptBus {
  /** Subscribes to a kind; returns the unsubscribe. */
  readonly on: <Payload>(kind: EventKind<Payload>, subscriber: (payload: Payload) => void) => () => void;
}

/** The bindings of a game's script events, by name: every event a behaviour handles must be bound. */
export type ScriptEventBindings<G extends ScriptTypes> = {
  readonly [Event in ScriptEventName<G>]?: ScriptEventBinding<G, G['scriptEvents'][Event]>;
};

/** What a script system is built from. */
export interface ScriptSystemOptions<G extends ScriptTypes> {
  /** The game's scripts (`defineScripts`). */
  readonly registry: ScriptRegistry<G>;

  /** The AI system, whose timers `collect` gathers onto their units. */
  readonly ai: AiSystem<G>;

  /** The proc system handlers' procs run through, or a function returning it. */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The bus the bound events are raised on. */
  readonly bus: ScriptBus;

  /** The game's events behaviours handle, each bound to its bus kind and the unit it reaches. */
  readonly bindings?: ScriptEventBindings<G>;

  /** The host handlers read (`ctx.host`). */
  readonly host: G['host'];
}

/**
 * A script system: it runs each scripted unit's behaviours and decides nothing itself. A unit whose
 * template names a script gets a record at spawn (each behaviour's state, then its `spawn` handlers); its timers are
 * gathered once a tick (`collect`) and delivered in its own step (`step`), with its `tick` handlers; bound game events
 * reach the unit their binding names. Units with no script cost nothing.
 */
export interface ScriptSystem<G extends ScriptTypes> {
  /** The game's scripts. */
  readonly registry: ScriptRegistry<G>;

  /** Live records, and records ever made: a steady state makes no new ones. */
  readonly records: {
    /** Records live. */
    readonly live: number;

    /** Records ever made. */
    readonly created: number;
  };

  /** The unit system's side: `createUnitSystem({ scripts: () => scripts.forUnits })`. */
  readonly forUnits: UnitScripts<G>;

  /**
   * Once a tick, before the units' loop: gathers every due timer (`ai.step`) onto its unit, to be delivered in that
   * unit's step. A due timer of a unit with no script goes to `fire`, when given. Returns how many came due.
   */
  readonly collect: (fire?: (unit: G['bearer'], timer: TimerId) => void) => number;

  /**
   * In the unit's own slot of the game's loop: delivers its due timers to its `timer` handlers, then runs its `tick`
   * handlers. Does nothing for a unit with no script.
   */
  readonly step: (unit: G['bearer']) => void;

  /** Whether a unit runs a script. */
  readonly has: (unit: G['bearer']) => boolean;

  /** A behaviour's state on a unit (a view, a debug panel); `undefined` when its script does not list it. */
  readonly stateOf: <State>(unit: G['bearer'], behaviour: Behaviour<G, State>) => State | undefined;

  /** How many units run a script now (a director's overlap rules): kept on attach and detach. */
  readonly count: (script: ScriptId) => number;
}

/** A script system: a class for fast properties, its functions arrow fields so they work detached. */
class Scripts<G extends ScriptTypes> implements ScriptSystem<G> {
  readonly registry: ScriptRegistry<G>;
  readonly records: ScriptSystem<G>['records'];
  readonly forUnits: UnitScripts<G>;
  readonly #options: ScriptSystemOptions<G>;
  readonly #records: ScriptRecord<G>[] = [];

  /** How many units run each script, by script id. */
  readonly #counts: Uint32Array;
  readonly #free: number[] = [];
  readonly #runner: ScriptRunner<G>;
  #fallback: ((unit: G['bearer'], timer: TimerId) => void) | undefined = undefined;

  constructor(options: ScriptSystemOptions<G>) {
    this.#options = options;
    this.registry = options.registry;
    this.#runner = new ScriptRunner<G>(options);
    this.#counts = new Uint32Array(options.registry.scripts.length);

    const records = this.#records;
    const free = this.#free;

    this.records = {
      get live() {
        return records.length - free.length;
      },

      get created() {
        return records.length;
      }
    };
    this.forUnits = { attach: this.#attach, start: this.#start, detach: this.#detach };
    this.#bind(options);
  }

  readonly collect = (fire?: (unit: G['bearer'], timer: TimerId) => void): number => {
    this.#fallback = fire;

    try {
      return this.#options.ai.step(this.#mark);
    } finally {
      this.#fallback = undefined;
    }
  };

  readonly step = (unit: G['bearer']): void => {
    const slot = unit.scriptSlot;

    if (slot < 0) {
      return;
    }

    const record = this.#records[slot];

    if (record === undefined) {
      return;
    }

    if (record.dueCount > 0) {
      this.#runner.deliver(record);
    }

    if (record.hasTick) {
      this.#runner.moment(record, 'tick');
    }
  };

  readonly has = (unit: G['bearer']): boolean => unit.scriptSlot >= 0;

  readonly stateOf = <State>(unit: G['bearer'], behaviour: Behaviour<G, State>): State | undefined => {
    const record = unit.scriptSlot < 0 ? undefined : this.#records[unit.scriptSlot];

    const index = record === undefined ? -1 : this.#runner.scriptOf(record).behaviours.indexOf(anyOf(behaviour));

    const state: unknown = index < 0 ? undefined : record?.states[index];

    return isStateOf(behaviour, state) ? state : undefined;
  };

  readonly count = (script: ScriptId): number => this.#counts[script] ?? 0;

  /** Marks a due timer on its unit's record, or hands it to the fallback. */
  readonly #mark = (unit: G['bearer'], timer: TimerId): void => {
    const record = unit.scriptSlot < 0 ? undefined : this.#records[unit.scriptSlot];

    if (record === undefined) {
      this.#fallback?.(unit, timer);

      return;
    }

    record.due[record.dueCount] = timer;
    record.dueCount += 1;
  };

  /** Makes a unit's record: its script and each behaviour's state. */
  readonly #attach = (unit: G['bearer'], name: G['scriptName']): number => {
    const ids: Readonly<Record<string, number | undefined>> = this.registry.id;
    const script = ids[name];

    if (script === undefined) {
      throw new RangeError(`There is no script named ${name}.`);
    }

    const slot = this.#free.pop() ?? this.#records.length;
    const record = (this.#records[slot] ??= new ScriptRecord<G>(unit));
    const compiled = this.registry.scripts[script] ?? noScript(script);
    const { behaviours } = compiled;

    record.unit = unit;
    record.script = script;
    record.isLive = true;
    record.hasTick = compiled.tick.length > 0;
    record.dueCount = 0;
    record.states.length = behaviours.length;

    for (const [index, behaviour] of behaviours.entries()) {
      record.states[index] = behaviour.state?.(unit);
    }

    this.#counts[script] = (this.#counts[script] ?? 0) + 1;

    return slot;
  };

  /** Runs a unit's `spawn` handlers. */
  readonly #start = (unit: G['bearer']): void => {
    const record = this.#records[unit.scriptSlot];

    if (record !== undefined) {
      this.#runner.moment(record, 'spawn');
    }
  };

  /** Frees a unit's record. */
  readonly #detach = (unit: G['bearer']): void => {
    const slot = unit.scriptSlot;
    const record = this.#records[slot];

    if (record === undefined || !record.isLive) {
      return;
    }

    record.isLive = false;
    record.dueCount = 0;
    record.states.fill(undefined);
    this.#counts[record.script] = (this.#counts[record.script] ?? 1) - 1;
    this.#free.push(slot);
  };

  /** Subscribes to each bound event some script handles; throws for a handled event with no binding. */
  #bind(options: ScriptSystemOptions<G>): void {
    const bindings: Readonly<Record<string, ScriptEventBinding<G, unknown> | undefined>> = options.bindings ?? {};

    for (const event of this.registry.events) {
      const binding = bindings[event];

      if (binding === undefined) {
        const script = this.registry.scripts.find((each) => each.on.has(event));

        throw new RangeError(`Script ${script?.key ?? '?'} handles ${event}, which the script system does not bind.`);
      }

      options.bus.on(binding.kind, (payload) => {
        this.#dispatch(event, binding.unitOf(payload), payload);
      });
    }
  }

  /** Delivers a bound event to its unit's handlers of it. */
  #dispatch(event: string, unit: G['bearer'] | undefined, payload: unknown): void {
    const record = unit === undefined || unit.scriptSlot < 0 ? undefined : this.#records[unit.scriptSlot];

    if (record?.isLive === true) {
      this.#runner.dispatch(record, event, payload);
    }
  }
}

/** A behaviour as the registry lists it. */
const anyOf = <G extends ScriptTypes, State>(behaviour: Behaviour<G, State>): AnyBehaviour<G> => behaviour;

/** Whether a state belongs to a behaviour: always, since the record holds each behaviour's own. */
const isStateOf = <G extends ScriptTypes, State>(_behaviour: Behaviour<G, State>, _state: unknown): _state is State =>
  true;

/**
 * Creates the script system: `createScriptSystem({ registry: SCRIPTS, ai, procs, bus, host, bindings:
 * { damaged: { kind: bus.kind.taken, unitOf: (e) => e.blow?.target } } })`, then `createUnitSystem({ …, scripts: () =>
 * scripts.forUnits })`. Throws for a handled event that is not bound.
 */
export const createScriptSystem = <G extends ScriptTypes>(options: ScriptSystemOptions<G>): ScriptSystem<G> =>
  Object.freeze(new Scripts(options));
