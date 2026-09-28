/**
 * How a countdown on one clock steps and when it is due (§II.6.1 rule 4). Every due comparison takes its epsilon from
 * its clock: swarm uses none on the world clock, `1e-8` on the motion clock, and `1e-6` or `1e-9` in a few places.
 */
export interface CountdownRule {
  /**
   * Whether a step that would land within `epsilon` of zero lands on zero (the motion rule). Without it a step is
   * `max(0, t − dt)` (the world rule).
   */
  readonly snap: boolean;

  /** The clock's epsilon: a value below it counts as run out. Zero means only zero itself is run out. */
  readonly epsilon: number;
}

/** The world clock's rule: a countdown steps as `max(0, t − dt)` and is due at zero. */
export const WORLD_COUNTDOWN: CountdownRule = Object.freeze({ snap: false, epsilon: 0 });

/** The motion clock's snap: a countdown that would land within this of zero lands on zero. */
export const MOTION_EPSILON = 1e-8;

/** The motion clock's rule: a step that would land below `1e-8` lands on zero, and it is due below `1e-8`. */
export const MOTION_COUNTDOWN: CountdownRule = Object.freeze({ snap: true, epsilon: MOTION_EPSILON });

/** The longest countdown `stepsUntil` walks step by step before it divides instead. */
const EXACT_STEPS = 120_000;

/** Builds a countdown rule with its own epsilon, for the places that need one (`1e-6`, `1e-9`). */
export const defineCountdown = (rule: CountdownRule): CountdownRule => Object.freeze({ ...rule });

/**
 * One step of a countdown by `dt` under `rule`: `max(0, t − dt)` on the world rule, and on a snapping rule
 * `t − dt`, or zero when that lands below the epsilon. Bit for bit what swarm's effect clocks compute.
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
