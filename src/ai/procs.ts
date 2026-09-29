import type { ChanceOption, ProcKindDef, ProcShape, ProcTarget } from '../procs/index.ts';
import type { AiTypes, TimerId } from './ai-types.ts';

/**
 * Starts (or restarts) a timer on the brain of the unit it lands on (§II.6 P3: `setPickDelay` and `resetTimer` are
 * this proc on the game's pick timer and its named timers): due `seconds` from now.
 */
export interface SetTimerProc<G extends AiTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'setTimer';

  /** The timer: its name in data, its id in code. */
  readonly timer: G['timerName'] | TimerId;

  /** The seconds until it is due, from 0. */
  readonly seconds: number;

  /** Whose brain; the list's self when absent. */
  readonly of?: ProcTarget<G>;
}

/** Stops a timer on the brain of the unit it lands on; `skipped` when it was not running. */
export interface CancelTimerProc<G extends AiTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'cancelTimer';

  /** The timer: its name in data, its id in code. */
  readonly timer: G['timerName'] | TimerId;

  /** Whose brain; the list's self when absent. */
  readonly of?: ProcTarget<G>;
}

/**
 * Sets the focus of the unit it lands on (§II.6 P3 `setFocus`, C5: a spell fixing its caster's target, the tether):
 * the list's target, its event unit, or none. The game's target policy reads the focus (`ai.focusOf`).
 */
export interface SetFocusProc<G extends AiTypes> extends ProcShape {
  /** The discriminant. */
  readonly kind: 'setFocus';

  /** The unit focused: the list's `target` (the default), its `eventUnit`, or `none` to clear it. */
  readonly focus?: 'target' | 'eventUnit' | 'none';

  /** Whose focus; the list's self when absent. */
  readonly of?: ProcTarget<G>;
}

/** The AI system's procs, as a union: a game adds them to its proc union (`gameProc`). */
export type AiProcs<G extends AiTypes> = SetTimerProc<G> | CancelTimerProc<G> | SetFocusProc<G>;

/** The AI system's proc kinds, by name: `createProcRegistry({ ...CORE_PROCS, ...ai.procKinds })`. */
export interface AiProcKinds<G extends AiTypes> {
  /** Starts a timer. */
  readonly setTimer: ProcKindDef<SetTimerProc<G>, G>;

  /** Stops a timer. */
  readonly cancelTimer: ProcKindDef<CancelTimerProc<G>, G>;

  /** Sets a focus. */
  readonly setFocus: ProcKindDef<SetFocusProc<G>, G>;
}

/** A `setTimer` proc: `setTimer('pick', 2)` sets the pick delay; `setTimer('raise', 0)` makes the raise due now. */
export const setTimer = <G extends AiTypes = AiTypes>(
  timer: G['timerName'] | TimerId,
  seconds: number,
  options: ChanceOption & Pick<SetTimerProc<G>, 'of'> = {},
): SetTimerProc<G> => ({ ...options, kind: 'setTimer', timer, seconds });

/** A `cancelTimer` proc: `cancelTimer('charge')`. */
export const cancelTimer = <G extends AiTypes = AiTypes>(
  timer: G['timerName'] | TimerId,
  options: ChanceOption & Pick<CancelTimerProc<G>, 'of'> = {},
): CancelTimerProc<G> => ({ ...options, kind: 'cancelTimer', timer });

/** A `setFocus` proc: `setFocus()` focuses the list's target; `setFocus({ focus: 'none' })` clears it. */
export const setFocus = <G extends AiTypes = AiTypes>(
  options: ChanceOption & Omit<SetFocusProc<G>, 'kind' | 'chance'> = {},
): SetFocusProc<G> => ({ ...options, kind: 'setFocus' });
