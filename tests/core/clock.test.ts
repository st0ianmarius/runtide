import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countDown,
  COUNTDOWN_EPSILON,
  createClock,
  DEFAULT_COUNTDOWN,
  defineCountdown,
  isRunOut,
  stepsUntil,
} from '../../src/core/index.ts';

/** A rule with no epsilon: `max(0, t − dt)`, due only at zero. */
const EXACT = defineCountdown({ snap: false, epsilon: 0 });

describe('the fixed-step clock', () => {
  it('derives time from the integer tick, so it never drifts', () => {
    const clock = createClock({ dt: 0.1 });

    for (let i = 0; i < 10; i++) {
      clock.step();
    }

    // Summing 0.1 ten times gives 0.9999999999999999; the clock multiplies instead.
    assert.equal(clock.tick, 10);
    assert.equal(clock.time, 1);
  });

  it('refuses a step that is not positive and finite', () => {
    assert.throws(() => createClock({ dt: 0 }), RangeError);
    assert.throws(() => createClock({ dt: Number.POSITIVE_INFINITY }), RangeError);
  });

  it('takes the default rule unless given one', () => {
    assert.equal(createClock({ dt: 1 / 60 }).countdown, DEFAULT_COUNTDOWN);
    assert.equal(createClock({ dt: 1 / 60, countdown: EXACT }).countdown, EXACT);
    assert.deepEqual(DEFAULT_COUNTDOWN, { snap: true, epsilon: 1e-6 });
    assert.equal(COUNTDOWN_EPSILON, 1e-6);
  });
});

describe('stamps', () => {
  it('fall due on the tick a countdown of the same length runs out', () => {
    for (const countdown of [DEFAULT_COUNTDOWN, EXACT]) {
      const clock = createClock({ dt: 0.1, countdown });
      const stamp = clock.stampAt(0.4);
      let left = 0.4;

      while (!isRunOut(left, clock.countdown)) {
        assert.equal(clock.isDue(stamp), false);
        left = countDown(left, clock.dt, clock.countdown);
        clock.step();
      }

      assert.equal(clock.isDue(stamp), true);
      assert.equal(stamp, clock.tick);
    }
  });

  it('report the seconds left and zero once due', () => {
    const clock = createClock({ dt: 0.5 });
    const stamp = clock.stampAt(2);

    clock.step();

    assert.equal(clock.remaining(stamp), 1.5);

    for (let i = 0; i < 5; i++) {
      clock.step();
    }

    assert.equal(clock.remaining(stamp), 0);
  });

  it('are now for a deadline already run out or infinite', () => {
    const clock = createClock({ dt: 1 / 60 });

    assert.equal(clock.stampAt(5e-7), 0);
    assert.equal(clock.stampAt(0), 0);
    assert.equal(clock.stampAt(Number.POSITIVE_INFINITY), 0);
  });
});

describe('countdowns', () => {
  it('step a rule without a snap as max(0, t − dt)', () => {
    assert.equal(countDown(0.5, 0.2, EXACT), 0.3);
    assert.equal(countDown(0.1, 0.2, EXACT), 0);
    assert.equal(countDown(5e-9, 0, EXACT), 5e-9);
  });

  it('snap the default rule to zero below 1e-6', () => {
    assert.equal(countDown(0.5 + 5e-7, 0.5, DEFAULT_COUNTDOWN), 0);
    assert.equal(countDown(0.5 + 2e-6, 0.5, DEFAULT_COUNTDOWN) > 0, true);
    assert.equal(countDown(0.5, 0.25, DEFAULT_COUNTDOWN), 0.25);
  });

  it('run out by their rule epsilon', () => {
    const coarse = defineCountdown({ snap: false, epsilon: 1e-3 });

    assert.equal(isRunOut(0, EXACT), true);
    assert.equal(isRunOut(1e-12, EXACT), false);
    assert.equal(isRunOut(5e-7, DEFAULT_COUNTDOWN), true);
    assert.equal(isRunOut(2e-6, DEFAULT_COUNTDOWN), false);
    assert.equal(isRunOut(5e-4, coarse), true);
    assert.equal(countDown(0.1005, 0.1, coarse), 0.0005000000000000004, 'no snap: the step itself is not rounded');
  });

  it('refuse an epsilon that is negative or not finite', () => {
    assert.throws(() => defineCountdown({ snap: true, epsilon: -1e-6 }), RangeError);
    assert.throws(() => defineCountdown({ snap: true, epsilon: Number.NaN }), RangeError);
    assert.throws(() => defineCountdown({ snap: false, epsilon: Number.POSITIVE_INFINITY }), RangeError);
  });

  it('count the steps by walking the float countdown, not by dividing', () => {
    // 0.4 / 0.1 is 4, but walking 0.4 down by 0.1 leaves 2.8e-17 after four steps: a rule with no epsilon needs a
    // fifth, and the default rule snaps it to zero on the fourth. The same holds for 3 s at 1/60 s.
    assert.equal(stepsUntil(0.4, 0.1, EXACT), 5);
    assert.equal(stepsUntil(0.4, 0.1, DEFAULT_COUNTDOWN), 4);
    assert.equal(stepsUntil(3, 1 / 60, EXACT), 181);
    assert.equal(stepsUntil(3, 1 / 60, DEFAULT_COUNTDOWN), 180);
    assert.equal(stepsUntil(1, 1 / 60, DEFAULT_COUNTDOWN), 60);
    assert.equal(stepsUntil(1, 0, DEFAULT_COUNTDOWN), 0);
  });

  it('end whole-step lengths on their whole step under the default rule', () => {
    for (const hertz of [10, 20, 30, 60, 64, 120]) {
      for (let steps = 1; steps <= 2000; steps++) {
        assert.equal(stepsUntil(steps / hertz, 1 / hertz, DEFAULT_COUNTDOWN), steps, `${steps} steps at ${hertz} Hz`);
      }
    }
  });

  it('divide past 120,000 steps', () => {
    assert.equal(stepsUntil(3000, 1 / 60, DEFAULT_COUNTDOWN), 180_000);
  });
});
