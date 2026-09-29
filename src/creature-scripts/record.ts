import type { TimerId } from '../ai/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { ProcOrigin } from '../procs/index.ts';
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

  /** Whether its script has any `tick` handler. */
  hasTick = false;

  /** Its index in its script's list of instances. */
  instance = -1;

  constructor(unit: G['bearer']) {
    this.unit = unit;
  }
}

/** The origin a handler's procs run for: its unit, credited to it. Reused. */
export class ScriptOrigin<G extends ScriptTypes> implements ProcOrigin<G> {
  self: G['bearer'];
  target: G['bearer'];
  source = NO_SOURCE;

  constructor(unit: G['bearer']) {
    this.self = unit;
    this.target = unit;
  }
}

/** A handler's context, one per nesting level: a class for fast properties, its `run` bound once. */
export class ScriptContext<G extends ScriptTypes> implements ScriptCtx<G> {
  unit: G['bearer'];
  state: unknown = undefined;
  shared: unknown = undefined;
  readonly host: G['host'];
  readonly run: (procs: ScriptReturn<G>) => number;

  constructor(parts: { readonly unit: G['bearer']; readonly host: G['host']; readonly run: ScriptContext<G>['run'] }) {
    this.unit = parts.unit;
    this.host = parts.host;
    this.run = parts.run;
  }
}
