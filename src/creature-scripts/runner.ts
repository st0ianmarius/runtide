import type { TimerId } from '../ai/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { CompiledScript, ScriptRegistry } from './define-scripts.ts';
import { ScriptContext, ScriptOrigin, type ScriptRecord } from './record.ts';
import type { AnyBehaviour, AnyEventHandler, ScriptEventName, ScriptReturn, ScriptTypes } from './script-types.ts';

/** A moment every behaviour may handle with no argument. */
export type Moment = 'spawn' | 'tick';

/** What a runner is built from: the scripts, the proc system and the host. */
export interface RunnerParts<G extends ScriptTypes> {
  /** The game's scripts. */
  readonly registry: ScriptRegistry<G>;

  /** The proc system, or a function returning it. */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The host handlers read. */
  readonly host: G['host'];
}

/**
 * Runs scripted units' handlers (§I.7.1 F19): one reused context and origin per nesting level, so a handler's procs
 * may reach another unit's handlers (an add dying tells its owner) without allocating.
 */
export class ScriptRunner<G extends ScriptTypes> {
  readonly #parts: RunnerParts<G>;

  /** Each script's behaviours' shared states, by script id and index: one per behaviour, made once. */
  readonly #shared: readonly (readonly unknown[])[];

  /** Each behaviour's shared state. */
  readonly #sharedBy = new Map<AnyBehaviour<G>, unknown>();

  readonly #contexts: ScriptContext<G>[] = [];
  readonly #origins: ScriptOrigin<G>[] = [];
  #depth = 0;

  constructor(parts: RunnerParts<G>) {
    this.#parts = parts;

    const made = this.#sharedBy;

    this.#shared = parts.registry.scripts.map((script) =>
      script.behaviours.map((behaviour) => {
        if (!made.has(behaviour)) {
          made.set(behaviour, behaviour.shared?.());
        }

        return made.get(behaviour);
      }),
    );
  }

  /** A behaviour's shared state; `undefined` for one no script lists, or with none. */
  sharedOf(behaviour: AnyBehaviour<G>): unknown {
    return this.#sharedBy.get(behaviour);
  }

  /** A record's compiled script. */
  scriptOf(record: ScriptRecord<G>): CompiledScript<G> {
    return this.#parts.registry.scripts[record.script] ?? noScript(record.script);
  }

  /** Runs one moment's handlers of a record, in behaviour order, while it stays attached. */
  moment(record: ScriptRecord<G>, moment: Moment): void {
    const script = this.scriptOf(record);

    for (const index of script[moment]) {
      const handler = script.behaviours[index]?.[moment];

      if (handler !== undefined && record.isLive) {
        const ctx = this.#enter(record, index);

        try {
          this.#runProcs(ctx, handler(ctx));
        } finally {
          this.#give();
        }
      }
    }
  }

  /** Delivers a record's due timers, in due order, to its `timer` handlers. */
  deliver(record: ScriptRecord<G>): void {
    const count = record.dueCount;

    record.dueCount = 0;

    for (let i = 0; i < count && record.isLive; i++) {
      const timer = record.due[i];

      if (timer !== undefined) {
        this.#timer(record, timer);
      }
    }
  }

  /** Delivers a bound event to a record's handlers of it. */
  dispatch(record: ScriptRecord<G>, event: string, payload: unknown): void {
    const script = this.scriptOf(record);

    for (const index of script.on.get(event) ?? NO_INDEXES) {
      const handler: AnyEventHandler<G> | undefined = script.behaviours[index]?.on?.[eventKey<G>(event)];

      if (handler !== undefined && record.isLive) {
        const ctx = this.#enter(record, index);

        try {
          this.#runProcs(ctx, handler(ctx, payload));
        } finally {
          this.#give();
        }
      }
    }
  }

  /** Delivers one due timer to a record's `timer` handlers. */
  #timer(record: ScriptRecord<G>, timer: TimerId): void {
    const script = this.scriptOf(record);

    for (const index of script.timer) {
      const handler = script.behaviours[index]?.timer;

      if (handler !== undefined && record.isLive) {
        const ctx = this.#enter(record, index);

        try {
          this.#runProcs(ctx, handler(ctx, timer));
        } finally {
          this.#give();
        }
      }
    }
  }

  /** Takes the next level's context for one of a record's behaviours; give it back with `#give`. */
  #enter(record: ScriptRecord<G>, index: number): ScriptContext<G> {
    const depth = this.#depth;

    const ctx: ScriptContext<G> = (this.#contexts[depth] ??= new ScriptContext<G>({
      unit: record.unit,
      host: this.#parts.host,
      run: (procs): number => this.#runProcs(ctx, procs),
    }));

    ctx.unit = record.unit;
    ctx.state = record.states[index];
    ctx.shared = this.#shared[record.script]?.[index];
    this.#depth = depth + 1;

    return ctx;
  }

  /** Gives back the innermost context. */
  #give(): void {
    this.#depth -= 1;

    const ctx = this.#contexts[this.#depth];

    if (ctx !== undefined) {
      ctx.state = undefined;
      ctx.shared = undefined;
    }
  }

  /** Runs procs for a context's unit, credited to it; how many went off. */
  #runProcs(ctx: ScriptContext<G>, procs: ScriptReturn<G>): number {
    if (procs === undefined || procs.length === 0) {
      return 0;
    }

    const origin = (this.#origins[this.#depth] ??= new ScriptOrigin<G>(ctx.unit));
    const { procs: system } = this.#parts;

    origin.self = ctx.unit;
    origin.target = ctx.unit;
    origin.source = ctx.unit.id;

    return (typeof system === 'function' ? system() : system).run(procs, origin);
  }
}

/** No behaviour indexes. */
const NO_INDEXES: readonly number[] = Object.freeze([]);

/** An event name as a key of a behaviour's handlers: the registry built every handled name from those keys. */
const eventKey = <G extends ScriptTypes>(event: string): ScriptEventName<G> => {
  if (!isEventName<G>(event)) {
    throw new RangeError(`Unknown script event ${event}.`);
  }

  return event;
};

/** Whether a string names a script event: every string the runner is handed does. */
const isEventName = <G extends ScriptTypes>(event: string): event is ScriptEventName<G> => typeof event === 'string';

/** A script id the registry does not have: the attach check prevents it. */
export const noScript = (script: number): never => {
  throw new RangeError(`There is no creature script ${script}.`);
};
