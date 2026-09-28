import { type CountdownRule, MOTION_COUNTDOWN, stepsUntil, WORLD_COUNTDOWN } from './countdown.ts';

/**
 * How a clock derives its time: `tick` (the default) computes `time = tick × dt` from the integer tick, so it never
 * drifts; `accumulate` adds `dt` every step (`time += dt`), for parity with a game that accumulates today.
 */
export type ClockMode = 'tick' | 'accumulate';

/** Which clock it is: the world clock (the simulation) or the motion clock (prediction), counted in its own steps. */
export type ClockKind = 'world' | 'motion';

/** A deadline on a clock: the absolute tick at which something ends or fires. */
export type Stamp = number;

/** What a clock is created from. */
export interface ClockOptions {
  /** The fixed step in seconds; the host never varies it. */
  readonly dt: number;

  /** How time is derived from the ticks; `tick` by default. */
  readonly mode?: ClockMode;

  /** Which clock it is; `world` by default. */
  readonly kind?: ClockKind;

  /** The countdown rule and epsilon; the kind's rule by default (`max(0, t − dt)` for world, the 1e-8 snap for motion). */
  readonly countdown?: CountdownRule;
}

/**
 * A fixed-step simulation clock owned by the host. It never reads a real clock: the host calls `step` once per tick
 * and hands `tick`, `dt` and `time` to every system. Deadlines are stamps (absolute ticks), which need no syncing and
 * cannot drift.
 */
export interface SimClock {
  /** The fixed step in seconds. */
  readonly dt: number;

  /** How `time` is derived. */
  readonly mode: ClockMode;

  /** Which clock it is. */
  readonly kind: ClockKind;

  /** The clock's countdown rule, whose epsilon every due comparison on this clock uses. */
  readonly countdown: CountdownRule;

  /** The number of steps taken so far. */
  readonly tick: number;

  /** The simulated time in seconds: `tick × dt`, or the running sum of `dt` in accumulating mode. */
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
  const { dt, mode = 'tick', kind = 'world' } = options;
  const countdown = options.countdown ?? (kind === 'motion' ? MOTION_COUNTDOWN : WORLD_COUNTDOWN);
  let tick = 0;
  let time = 0;

  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError(`A clock needs a positive finite step; got ${dt}.`);
  }

  return {
    dt,
    mode,
    kind,
    countdown,

    get tick() {
      return tick;
    },

    get time() {
      return time;
    },

    step: () => {
      tick += 1;
      time = mode === 'tick' ? tick * dt : time + dt;
    },

    stampAt: (seconds) => tick + stepsUntil(seconds, dt, countdown),
    isDue: (stamp) => tick >= stamp,
    remaining: (stamp) => (tick >= stamp ? 0 : (stamp - tick) * dt),
  };
};

/** Creates the motion clock: a second fixed-step clock counted in motion steps, with the motion rule's 1e-8 snap. */
export const createMotionClock = (options: Omit<ClockOptions, 'kind'>): SimClock =>
  createClock({ ...options, kind: 'motion' });
