import { stepsUntil } from './countdown.ts';

/** A deadline on a clock: the absolute tick at which something ends or fires. */
export type Stamp = number;

/** What a clock is created from. */
export interface ClockOptions {
  /** The fixed step in seconds; the host never varies it. */
  readonly dt: number;

  /**
   * The tick it starts at, a whole number from 0; 0 by default. A run resumed from a save starts at its saved tick, so
   * stamps and keyed-roll keys (a cast's start tick, an area trigger's spawn tick) go on from there rather than repeat.
   * Make the systems over it after, since their timing wheels start at the clock's tick.
   */
  readonly tick?: number;
}

/**
 * A fixed-step simulation clock owned by the host. It never reads a real clock: the host calls `step` once per tick
 * and hands `tick`, `dt` and `time` to every system. Time is derived from the integer tick, never accumulated, so it
 * cannot drift. Deadlines are stamps (absolute ticks), which need no syncing either. A game runs as many clocks as it
 * needs (a world clock, a second clock for prediction), each with its own step.
 */
export interface SimClock {
  /** The fixed step in seconds. */
  readonly dt: number;

  /** The number of steps taken so far. */
  readonly tick: number;

  /** The simulated time in seconds: `tick × dt`. */
  readonly time: number;

  /** Advances the clock by one fixed step. */
  readonly step: () => void;

  /**
   * The stamp for something that ends `seconds` from now: now plus the steps `seconds` take (`stepsUntil`), so a stamp
   * and a countdown of the same length end on the same tick. Now itself for `seconds` already run out.
   */
  readonly stampAt: (seconds: number) => Stamp;

  /** Whether a stamp has come: the clock's tick is at or past it. */
  readonly isDue: (stamp: Stamp) => boolean;

  /** The seconds left until a stamp: `(stamp − tick) × dt`, or zero once it is due. */
  readonly remaining: (stamp: Stamp) => number;
}

/** A clock's state: a class for fast properties, its functions arrow fields so they work detached. */
class FixedClock implements SimClock {
  readonly dt: number;
  #tick: number;

  constructor(dt: number, tick: number) {
    this.dt = dt;
    this.#tick = tick;
  }

  get tick(): number {
    return this.#tick;
  }

  get time(): number {
    return this.#tick * this.dt;
  }

  readonly step = (): void => {
    this.#tick += 1;
  };

  readonly stampAt = (seconds: number): Stamp => this.#tick + stepsUntil(seconds, this.dt);
  readonly isDue = (stamp: Stamp): boolean => this.#tick >= stamp;
  readonly remaining = (stamp: Stamp): number => (this.#tick >= stamp ? 0 : (stamp - this.#tick) * this.dt);
}

/**
 * Creates a fixed-step clock at its start tick (0 by default). Throws unless `dt` is a positive finite number and the
 * tick a whole number from 0.
 */
export const createClock = (options: ClockOptions): SimClock => {
  const { dt, tick = 0 } = options;

  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new RangeError(`A clock needs a positive finite step; got ${dt}.`);
  }

  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`A clock starts at a whole tick from 0; got ${tick}.`);
  }

  return new FixedClock(dt, tick);
};
