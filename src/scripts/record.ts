import type { TimerId } from '../ai/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { Proc, ProcOrigin, ProcOutcome } from '../procs/index.ts';
import type { ScriptCtx, ScriptReturn, ScriptTypes } from './script-types.ts';

/** One scripted unit's record: its script, each behaviour's state, and the timers due in its next step. */
export class ScriptRecord<G extends ScriptTypes> {
  /** The unit. */
  unit: G['bearer'];

  /** Its script's id. */
  script = 0;

  /** Each behaviour's state, by index. */
  readonly states: unknown[] = [];

  /** The timers due, in due order, valid up to `dueCount`. */
  readonly due: TimerId[] = [];

  /** How many timers are due. */
  dueCount = 0;

  /** Whether the record is attached to a unit. */
  isLive = false;

  /** Bumped as the record is attached and detached: a handler loop stops once it changes under it. */
  serial = 0;

  /** Whether its script has any `tick` handler. */
  hasTick = false;

  /** Whether its script has any `timer` handler: a unit's timers go to the game's fallback when it has none. */
  hasTimer = false;

  /** Whether its unit is dead: its step and bound events are skipped until a revive. */
  isDead = false;

  constructor(unit: G['bearer']) {
    this.unit = unit;
  }
}

/** The origin a handler's procs run for: its unit, credited to it, and the bound event it answers, if any. Reused. */
export class ScriptOrigin<G extends ScriptTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  target: G['bearer'];
  source = NO_SOURCE;
  eventUnit: G['bearer'] | undefined = undefined;
  other: G['bearer'] | undefined = undefined;
  payload: unknown = undefined;

  constructor(unit: G['bearer']) {
    this.self = unit;
    this.target = unit;
  }
}

/** What a context is built from: its first unit, the host, and its `run` and `apply`, bound once. */
interface ContextParts<G extends ScriptTypes> {
  /** The unit it is first made for. */
  readonly unit: G['bearer'];

  /** The host. */
  readonly host: G['host'];

  /** Runs procs for the context's unit. */
  readonly run: (procs: ScriptReturn<G>) => number;

  /** Applies one proc for the context's unit. */
  readonly apply: (proc: Proc<G>) => ProcOutcome;
}

/**
 * A handler's context, one per nesting level: a class for fast properties, its `run` and `apply` bound once. It knows
 * the record it runs for and that record's serial, so procs run only while the record is still the same unit's.
 */
export class ScriptContext<G extends ScriptTypes> implements ScriptCtx<G> {
  unit: G['bearer'];
  state: unknown = undefined;
  readonly host: G['host'];
  readonly run: (procs: ScriptReturn<G>) => number;
  readonly apply: (proc: Proc<G>) => ProcOutcome;

  /** The record the handler runs for; `undefined` between handlers. */
  record: ScriptRecord<G> | undefined = undefined;

  /** The record's serial as the handler started. */
  serial = 0;

  /** Whether the handler is a `died` one, whose procs run though the unit is dead. */
  isDying = false;

  /** The bound event's unit, for `eventUnit` targets. */
  eventUnit: G['bearer'] | undefined = undefined;

  /** The bound event's other unit, for `other` targets. */
  other: G['bearer'] | undefined = undefined;

  /** The bound event's payload. */
  payload: unknown = undefined;

  constructor(parts: ContextParts<G>) {
    this.unit = parts.unit;
    this.host = parts.host;
    this.run = parts.run;
    this.apply = parts.apply;
  }

  /** Whether the handler's procs may still run: its record is the same unit's, alive, or the moment is `died`. */
  get isRunning(): boolean {
    const { record } = this;

    return record !== undefined && record.serial === this.serial && (this.isDying || !record.isDead);
  }
}
