/**
 * The countdown epsilon, in seconds: a microsecond, far below any step a game runs at and far above
 * the rounding a float countdown collects on its way down, so a length runs out on the step its seconds say (0.1 s at
 * 1/60 s on the sixth step) instead of leaving a sliver for one more. Every clock and every countdown uses it.
 */
export const COUNTDOWN_EPSILON = 1e-6;

/**
 * One step of a countdown by `dt`: `t − dt`, or zero when that lands below the epsilon. One subtraction per step, so
 * the float a countdown holds is fully determined by its start, `dt` and the number of steps. An infinite countdown
 * stays infinite and never runs out, as `stepsUntil` counts it.
 */
export const countDown = (remaining: number, dt: number): number => {
  const next = remaining - dt;

  return next < COUNTDOWN_EPSILON ? 0 : next;
};

/** Whether a countdown has run out: below the epsilon. Never for an infinite one. */
export const isRunOut = (remaining: number): boolean => remaining < COUNTDOWN_EPSILON;

/**
 * How many steps of `dt` it takes `seconds` to run out: `⌈(seconds − ε) / dt⌉`, at least one for a length not run
 * out already, so a stamp lands on the step a countdown of the same length does (they could part only for a length
 * within rounding of a whole number of steps plus the epsilon, which no game writes). Zero for a length already run
 * out or a non-positive `dt`; `Infinity` for an infinite length, which a countdown never runs out either. Throws a
 * `RangeError` for a negative or NaN length, which is no length at all.
 */
export const stepsUntil = (seconds: number, dt: number): number => {
  if (!(seconds >= 0)) {
    throw new RangeError(`A length is seconds from 0; got ${seconds}.`);
  }

  if (!(dt > 0) || isRunOut(seconds)) {
    return 0;
  }

  if (seconds === Infinity) {
    return Infinity;
  }

  return Math.max(1, Math.ceil((seconds - COUNTDOWN_EPSILON) / dt));
};
