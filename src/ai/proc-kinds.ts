import { PROC_LANDED, PROC_SKIPPED, type ProcContext, type ProcKindDef } from '../procs/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';
import { brainOf } from './brain.ts';
import type { AiProcKinds, CancelTimerProc, SetFocusProc, SetTimerProc } from './procs.ts';
import type { Scheduler } from './scheduler.ts';
import type { TimerTable } from './timers.ts';

/** What the kinds reach: the timers table and the scheduler. */
interface KindParts<G extends AiTypes> {
  /** The game's timers. */
  readonly timers: TimerTable<G['timerName']>;

  /** The scheduler. */
  readonly scheduler: Scheduler<G>;
}

/** A timer's id from its name or id. Throws for one the table does not have. */
const timerIdOf = <G extends AiTypes>(timers: TimerTable<G['timerName']>, timer: G['timerName'] | TimerId): TimerId => {
  const ids: Readonly<Record<string, TimerId | undefined>> = timers.id;
  const id = typeof timer === 'string' ? ids[timer] : timer;

  if (id === undefined || !(id >= 0 && id < timers.names.length)) {
    throw new RangeError(`unknown timer ${timer}.`);
  }

  return id;
};

/** Throws unless a timer's seconds are sound. */
const checkSeconds = (seconds: number): void => {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) {
    throw new RangeError(`a setTimer proc waits a finite number of seconds from 0; got ${seconds}.`);
  }
};

/** The `setTimer` kind. */
const setTimerKind = <G extends AiTypes>(parts: KindParts<G>): ProcKindDef<SetTimerProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, _ctx, unit) => {
    if (unit === undefined) {
      return PROC_SKIPPED;
    }

    parts.scheduler.start(unit, timerIdOf(parts.timers, proc.timer), proc.seconds);

    return PROC_LANDED;
  },

  prepare: (proc) => {
    checkSeconds(proc.seconds);

    return { ...proc, timer: timerIdOf(parts.timers, proc.timer) };
  },

  explain: (proc) => ({ values: { timer: timerIdOf(parts.timers, proc.timer), seconds: proc.seconds } }),
});

/** The `cancelTimer` kind. */
const cancelTimerKind = <G extends AiTypes>(parts: KindParts<G>): ProcKindDef<CancelTimerProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, _ctx, unit) =>
    unit !== undefined && parts.scheduler.cancel(unit, timerIdOf(parts.timers, proc.timer))
      ? PROC_LANDED
      : PROC_SKIPPED,

  prepare: (proc) => ({ ...proc, timer: timerIdOf(parts.timers, proc.timer) }),
});

/** The entity id a `setFocus` proc focuses; −1 for none. */
const focusIdOf = <G extends AiTypes>(proc: SetFocusProc<G>, ctx: ProcContext<G>): number => {
  const focus = proc.focus ?? 'target';

  if (focus === 'none') {
    return -1;
  }

  const unit = focus === 'target' ? ctx.target : ctx.eventUnit;

  if (unit === undefined) {
    return -1;
  }

  const { idOf } = ctx.host;

  if (idOf === undefined) {
    throw new TypeError('A setFocus proc needs the proc host’s idOf.');
  }

  return idOf(unit);
};

/** The `setFocus` kind. */
const setFocusKind = <G extends AiTypes>(): ProcKindDef<SetFocusProc<G>, G> => ({
  targetOf: (proc) => proc.to ?? 'self',

  apply: (proc, ctx, unit) => {
    if (unit === undefined) {
      return PROC_SKIPPED;
    }

    brainOf(unit.brain).focus = focusIdOf(proc, ctx);

    return PROC_LANDED;
  },
});

/** Builds the AI system's proc kinds. */
export const createAiProcKinds = <G extends AiTypes>(parts: KindParts<G>): AiProcKinds<G> =>
  Object.freeze({ setTimer: setTimerKind(parts), cancelTimer: cancelTimerKind(parts), setFocus: setFocusKind<G>() });
