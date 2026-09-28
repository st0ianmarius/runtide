import { type CountdownRule, DEFAULT_COUNTDOWN, stepsUntil } from './countdown.ts';

/** A deadline on a clock: the absolute tick at which something ends or fires. */
export type Stamp = number;

/** What a clock is created from. */
export interface ClockOptions {
  /** The fixed step in seconds; the host never varies it. */
  readonly dt: number;

  /**
   * How a countdown on this clock steps and when it is due, which also decides the tick a stamp lands on;
   * `DEFAULT_COUNTDOWN` (a snap within `1e-6` of zero) unless the game passes its own rule (`defineCountdown`).
   */
  readonly countdown?: CountdownRule;
}

/**
 * A fixed-step simulation clock owned by the host. It never reads a real clock: the host calls `step` once per tick
 * and hands `tick`, `dt` and `time` to every system. Time is derived from the integer tick, never accumulated, so it
 * cannot drift. Deadlines are stamps (absolute ticks), which need no syncing either. A game runs as many clocks as it
 * needs (a world clock, a second clock for prediction), each with its own step and rule.
 */
export interface SimClock {
  /** The fixed step in seconds. */
  readonly dt: number;

  /** The clock's countdown rule, whose epsilon every due comparison on this clock uses. */
  readonly countdown: CountdownRule;

  /** The number of steps taken so far. */
  readonly tick: number;

  /** The simulated time in seconds: `tick × dt`. */
  readonly time: number;

  /** Advances the clock by one fixed step. */
  readonly step: () => void;

  /**
   * The stamp for something that ends `seconds` from now: now plus the steps a countdown of `seconds` takes to run
   * out under this clock's rule, so a stamp and a countdown end on the same tick. Now itself for `seconds` already
   * run out.
   */
  readonly stampAt: (seconds: number) => Stamp;

  /** Whether a stamp has come: the clock's tick is at or past it. */
  readonly isDue: (stamp: Stamp) => boolean;

  /** The seconds left until a stamp: `(stamp − tick) × dt`, or zero once it is due. */
  readonly remaining: (stamp: Stamp) => number;
}

/** Creates a fixed-step clock at tick zero and time zero. Throws unless `dt` is a positive finite number. */
export const createClock = (options: ClockOptions): SimClock => {
  const { dt, countdown = DEFAULT_COUNTDOWN } = options;
  let tick = 0;

  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError(`A clock needs a positive finite step; got ${dt}.`);
  }

  return {
    dt,
    countdown,

    get tick() {
      return tick;
    },

    get time() {
      return tick * dt;
    },

    step: () => {
      tick += 1;
    },

    stampAt: (seconds) => tick + stepsUntil(seconds, dt, countdown),
    isDue: (stamp) => tick >= stamp,
    remaining: (stamp) => (tick >= stamp ? 0 : (stamp - tick) * dt),
  };
};
