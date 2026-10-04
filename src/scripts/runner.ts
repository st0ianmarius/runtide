import type { TimerId } from '../ai/index.ts';
import { type Proc, PROC_SKIPPED, type ProcOutcome, type ProcSystem } from '../procs/index.ts';
import type { CompiledScript, ScriptRegistry } from './define-scripts.ts';
import { ScriptContext, ScriptOrigin, type ScriptRecord } from './record.ts';
import type { AnyEventHandler, ScriptEventName, ScriptReturn, ScriptTypes } from './script-types.ts';

/** Where delivered timers are checked: the AI system's `take`. */
export interface DueTimers<G extends ScriptTypes> {
  /** Whether a collected timer still stands, taking it. */
  readonly take: (unit: G['bearer'], timer: TimerId) => boolean;
}

/** A moment every behaviour may handle with no argument. */
export type Moment = 'spawn' | 'tick' | 'died' | 'revived';

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
 * Runs scripted units' handlers: one reused context and origin per nesting level, so a handler's procs
 * may reach another unit's handlers (an add dying tells its owner) without allocating.
 */
export class ScriptRunner<G extends ScriptTypes> {
  readonly #parts: RunnerParts<G>;

  readonly #contexts: ScriptContext<G>[] = [];
  readonly #origins: ScriptOrigin<G>[] = [];
  #depth = 0;

  constructor(parts: RunnerParts<G>) {
    this.#parts = parts;
  }

  /** A record's compiled script. */
  scriptOf(record: ScriptRecord<G>): CompiledScript<G> {
    return this.#parts.registry.scripts[record.script] ?? noScript(record.script);
  }

  /** Runs a moment's handlers while attached to the same unit; only `died` handlers run while dead. */
  moment(record: ScriptRecord<G>, moment: Moment): void {
    const script = this.scriptOf(record);
    const { serial } = record;

    for (const index of script[moment]) {
      const handler = script.behaviours[index]?.[moment];

      if (handler !== undefined && record.serial === serial && (moment === 'died' || !record.isDead)) {
        const ctx = this.#enter(record, index);

        ctx.isDying = moment === 'died';

        try {
          this.#runProcs(ctx, handler(ctx));
        } finally {
          this.#give();
        }
      }
    }
  }

  /**
   * Delivers a record's due timers, in due order, to its `timer` handlers: each one `timers` still holds (a handler
   * before it may have cancelled or restarted it).
   */
  deliver(record: ScriptRecord<G>, timers: DueTimers<G>): void {
    const count = record.dueCount;
    const { serial, unit } = record;
    let i = 0;

    record.dueCount = 0;

    try {
      for (; i < count && record.serial === serial && !record.isDead; i++) {
        const timer = record.due[i];

        if (timer !== undefined && timers.take(unit, timer)) {
          this.#timer(record, timer);
        }
      }
    } catch (error) {
      // A handler threw: the timers due after it, already taken off the wheel, wait for the unit's next step.
      if (record.serial === serial && !record.isDead) {
        keepUndelivered(record, [i + 1, count]);
      }

      throw error;
    }
  }

  /**
   * Delivers a bound event to a record's handlers of it; their procs' `eventUnit` and `other` targets are the event's
   * units its binding names (`eventUnitOf`, `otherOf`).
   */
  dispatch(
    record: ScriptRecord<G>,
    event: string,
    payload: unknown,
    eventUnit: G['bearer'] | undefined,
    other: G['bearer'] | undefined
  ): void {
    const script = this.scriptOf(record);
    const { serial } = record;

    for (const index of script.on.get(event) ?? NO_INDEXES) {
      const handler: AnyEventHandler<G> | undefined = script.behaviours[index]?.on?.[eventKey<G>(event)];

      if (handler !== undefined && record.serial === serial && !record.isDead) {
        const ctx = this.#enter(record, index);

        ctx.eventUnit = eventUnit;
        ctx.other = other;
        ctx.payload = payload;

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
    const { serial } = record;

    for (const index of script.timer) {
      const handler = script.behaviours[index]?.timer;

      if (handler !== undefined && record.serial === serial && !record.isDead) {
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
      apply: (proc): ProcOutcome => this.#apply(ctx, proc)
    }));

    ctx.unit = record.unit;
    ctx.state = record.states[index];
    ctx.record = record;
    ctx.serial = record.serial;
    this.#depth = depth + 1;

    return ctx;
  }

  /** Gives back the innermost context. */
  #give(): void {
    this.#depth -= 1;

    const ctx = this.#contexts[this.#depth];

    if (ctx !== undefined) {
      ctx.state = undefined;
      ctx.record = undefined;
      ctx.isDying = false;
      ctx.eventUnit = undefined;
      ctx.other = undefined;
      ctx.payload = undefined;
    }
  }

  /** Runs procs for a context's unit, credited to it, while its handler still may; how many went off. */
  #runProcs(ctx: ScriptContext<G>, procs: ScriptReturn<G>): number {
    if (procs === undefined || procs.length === 0 || !ctx.isRunning) {
      return 0;
    }

    return this.#system().run(procs, this.#originOf(ctx));
  }

  /** Applies one proc for a context's unit, credited to it, while its handler still may; what it did. */
  #apply(ctx: ScriptContext<G>, proc: Proc<G>): ProcOutcome {
    return ctx.isRunning ? this.#system().apply(proc, this.#originOf(ctx)) : PROC_SKIPPED;
  }

  /** The proc system. */
  #system(): ProcSystem<G> {
    const { procs } = this.#parts;

    return typeof procs === 'function' ? procs() : procs;
  }

  /** This level's origin, set for a context: its unit, credited to it, and the event it answers, if any. */
  #originOf(ctx: ScriptContext<G>): ScriptOrigin<G> {
    const origin = (this.#origins[this.#depth] ??= new ScriptOrigin<G>(ctx.unit));

    origin.self = ctx.unit;
    origin.target = ctx.unit;
    origin.source = ctx.unit.id;
    origin.eventUnit = ctx.eventUnit;
    origin.other = ctx.other;
    origin.payload = ctx.payload;

    return origin;
  }
}

/**
 * Puts a record's undelivered due timers (`from` to `count` of its list) back as due, after any marked meanwhile, so
 * its next step delivers them rather than leaving them collected and never fired.
 */
const keepUndelivered = <G extends ScriptTypes>(
  record: ScriptRecord<G>,
  [from, count]: readonly [number, number]
): void => {
  const marked = record.dueCount;

  if (from < count && marked <= from) {
    record.due.copyWithin(marked, from, count);
    record.dueCount = marked + count - from;
  }
};

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
  throw new RangeError(`There is no script ${script}.`);
};
