import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countDown, COUNTDOWN_EPSILON, createClock, isRunOut, stepsUntil } from '../../src/core/index.ts';

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

  it('starts at a saved tick, and refuses one that is not whole from 0', () => {
    const clock = createClock({ dt: 0.5, tick: 40 });

    clock.step();
    assert.deepEqual([clock.tick, clock.time, clock.stampAt(1)], [41, 20.5, 43]);
    assert.throws(() => createClock({ dt: 0.5, tick: -1 }), /whole tick from 0/);
    assert.throws(() => createClock({ dt: 0.5, tick: 1.5 }), /whole tick from 0/);
  });

  it('refuses a step that is not positive and finite', () => {
    assert.throws(() => createClock({ dt: 0 }), RangeError);
    assert.throws(() => createClock({ dt: Number.POSITIVE_INFINITY }), RangeError);
  });
});

describe('stamps', () => {
  it('fall due on the tick a countdown of the same length runs out', () => {
    for (const [dt, seconds] of [
      [0.1, 0.4],
      [1 / 60, 0.1],
      [1 / 60, 2.35],
      [1 / 30, 17.2]
    ] as const) {
      const clock = createClock({ dt });
      const stamp = clock.stampAt(seconds);
      let left: number = seconds;

      while (!isRunOut(left)) {
        assert.equal(clock.isDue(stamp), false);
        left = countDown(left, clock.dt);
        clock.step();
      }

      assert.equal(clock.isDue(stamp), true);
      assert.equal(stamp, clock.tick, `${seconds} s at ${dt} s`);
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

  it('are now for a deadline already run out', () => {
    const clock = createClock({ dt: 1 / 60 });

    assert.equal(clock.stampAt(5e-7), 0);
    assert.equal(clock.stampAt(0), 0);
  });

  it('never fall due for an infinite deadline, and refuse a NaN or negative one', () => {
    const clock = createClock({ dt: 1 / 60 });
    const stamp = clock.stampAt(Number.POSITIVE_INFINITY);

    for (let i = 0; i < 100; i++) {
      clock.step();
    }

    assert.equal(stamp, Number.POSITIVE_INFINITY);
    assert.equal(clock.isDue(stamp), false);
    assert.equal(clock.remaining(stamp), Number.POSITIVE_INFINITY);
    assert.throws(() => clock.stampAt(Number.NaN), /seconds from 0; got NaN/);
    assert.throws(() => clock.stampAt(-1), /seconds from 0; got -1/);
  });
});

describe('countdowns', () => {
  it('step as t − dt, snapping to zero below the epsilon', () => {
    assert.equal(COUNTDOWN_EPSILON, 1e-6);
    assert.equal(countDown(0.5, 0.25), 0.25);
    assert.equal(countDown(0.5 + 5e-7, 0.5), 0);
    assert.equal(countDown(0.5 + 2e-6, 0.5) > 0, true);
    assert.equal(countDown(0.1, 0.2), 0);
  });

  it('run out below the epsilon', () => {
    assert.equal(isRunOut(0), true);
    assert.equal(isRunOut(5e-7), true);
    assert.equal(isRunOut(2e-6), false);
  });

  it('count the steps a length takes, the step its seconds say: no sliver for one more', () => {
    // Walking 0.4 down by 0.1 leaves 2.8e-17 after four steps, and 3 s at 1/60 s a sliver after 180: the epsilon ends
    // both on the step their seconds say.
    assert.equal(stepsUntil(0.4, 0.1), 4);
    assert.equal(stepsUntil(3, 1 / 60), 180);
    assert.equal(stepsUntil(0.1, 1 / 60), 6);
    assert.equal(stepsUntil(0.1 + 1 / 120, 1 / 60), 7);
    assert.equal(stepsUntil(3000, 1 / 60), 180_000);
    assert.equal(stepsUntil(2e-6, 1 / 60), 1);
    assert.equal(stepsUntil(1, 0), 0);
  });

  it('take infinite steps for an infinite length, as a countdown never runs it out', () => {
    assert.equal(stepsUntil(Number.POSITIVE_INFINITY, 1 / 60), Number.POSITIVE_INFINITY);
    assert.equal(countDown(Number.POSITIVE_INFINITY, 1 / 60), Number.POSITIVE_INFINITY);
    assert.equal(isRunOut(Number.POSITIVE_INFINITY), false);
    assert.throws(() => stepsUntil(Number.NaN, 1 / 60), RangeError);
    assert.throws(() => stepsUntil(Number.NEGATIVE_INFINITY, 1 / 60), RangeError);
    assert.throws(() => stepsUntil(-0.5, 1 / 60), RangeError);
  });

  it('agree with walking the countdown down, for any length', () => {
    const walked = (remaining: number, dt: number): number => {
      let left = remaining;
      let steps = 0;

      while (!isRunOut(left)) {
        left = countDown(left, dt);
        steps += 1;
      }

      return steps;
    };

    for (const dt of [1 / 60, 1 / 30, 0.125]) {
      for (const seconds of [0.3, 0.35, 2.1, 3, 17.35, 60, 600.25]) {
        assert.equal(stepsUntil(seconds, dt), walked(seconds, dt), `${seconds} s at ${dt} s`);
      }
    }
  });

  it('end whole-step lengths on their whole step', () => {
    for (const hertz of [10, 20, 30, 60, 64, 120]) {
      for (let steps = 1; steps <= 2000; steps++) {
        assert.equal(stepsUntil(steps / hertz, 1 / hertz), steps, `${steps} steps at ${hertz} Hz`);
      }
    }
  });
});
