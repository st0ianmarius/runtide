/**
 * How a countdown on one clock steps and when it is due (§II.6.1 rule 4). Every due comparison takes its epsilon from
 * its clock's rule, so a float countdown and a stamp on the same clock always end on the same tick. A game picks the
 * rule per clock: `DEFAULT_COUNTDOWN`, or any rule it builds with `defineCountdown`.
 */
export interface CountdownRule {
  /**
   * Whether a step that would land below `epsilon` lands on zero (a snapping rule). Without it a step is
   * `max(0, t − dt)`, and the epsilon only decides when the countdown counts as run out.
   */
  readonly snap: boolean;

  /** The clock's epsilon: a value below it counts as run out. Zero means only zero itself is run out. */
  readonly epsilon: number;
}

/**
 * The default snap epsilon, in seconds: a microsecond, far below any step a game runs at and far above the rounding a
 * float countdown collects on its way down, so a length that is a whole number of steps in decimal (3 s at 1/60 s)
 * runs out on exactly that many steps instead of leaving a sliver for one more.
 */
export const COUNTDOWN_EPSILON = 1e-6;

/**
 * The default rule of every clock: a step that would land below `1e-6` lands on zero, and a countdown below `1e-6`
 * has run out. A game that wants another rule (no epsilon at all, or its own) builds it with `defineCountdown`.
 */
export const DEFAULT_COUNTDOWN: CountdownRule = Object.freeze({ snap: true, epsilon: COUNTDOWN_EPSILON });

/** The longest countdown `stepsUntil` walks step by step before it divides instead. */
const EXACT_STEPS = 120_000;

/**
 * Builds a countdown rule with its own snap and epsilon (`defineCountdown({ snap: false, epsilon: 0 })` steps as
 * `max(0, t − dt)` and is due only at zero). Throws unless the epsilon is a finite number from 0.
 */
export const defineCountdown = (rule: CountdownRule): CountdownRule => {
  if (!(rule.epsilon >= 0) || !Number.isFinite(rule.epsilon)) {
    throw new RangeError(`A countdown epsilon is a finite number from 0; got ${rule.epsilon}.`);
  }

  return Object.freeze({ snap: rule.snap, epsilon: rule.epsilon });
};

/**
 * One step of a countdown by `dt` under `rule`: `max(0, t − dt)` without a snap, and with one `t − dt`, or zero when
 * that lands below the epsilon. One subtraction per step, so the float a countdown holds is fully determined by its
 * start, `dt` and the number of steps.
 */
export const countDown = (remaining: number, dt: number, rule: CountdownRule): number => {
  if (!rule.snap) {
    return Math.max(0, remaining - dt);
  }

  const next = remaining - dt;

  return next < rule.epsilon ? 0 : next;
};

/** Whether a countdown has run out under `rule`: below the epsilon, or at or below zero when the epsilon is zero. */
export const isRunOut = (remaining: number, rule: CountdownRule): boolean =>
  rule.epsilon > 0 ? remaining < rule.epsilon : remaining <= 0;

/**
 * How many steps of `dt` it takes a countdown from `remaining` to run out under `rule`, walked rather than divided,
 * so the answer is exactly the step on which `countDown` reaches zero. Beyond 120,000 steps it divides instead, which
 * can land one step off the walk. Zero for a countdown already run out, an infinite one or a non-positive `dt`.
 */
export const stepsUntil = (remaining: number, dt: number, rule: CountdownRule): number => {
  if (!(dt > 0) || !Number.isFinite(remaining) || isRunOut(remaining, rule)) {
    return 0;
  }

  if (remaining / dt > EXACT_STEPS) {
    return Math.ceil((remaining - rule.epsilon) / dt);
  }

  let left = remaining;
  let steps = 0;

  while (!isRunOut(left, rule)) {
    left = countDown(left, dt, rule);
    steps += 1;
  }

  return steps;
};
