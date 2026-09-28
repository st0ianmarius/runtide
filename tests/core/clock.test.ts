import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countDown,
  createClock,
  createMotionClock,
  defineCountdown,
  isRunOut,
  MOTION_COUNTDOWN,
  stepsUntil,
  WORLD_COUNTDOWN,
} from '../../src/core/index.ts';

describe('the fixed-step clock', () => {
  it('derives time from the integer tick by default, so it never drifts', () => {
    const clock = createClock({ dt: 0.1 });

    for (let i = 0; i < 10; i++) {
      clock.step();
    }

    assert.equal(clock.tick, 10);
    assert.equal(clock.time, 1);
  });

  it('accumulates time += dt in accumulating mode, as swarm does', () => {
    const clock = createClock({ dt: 0.1, mode: 'accumulate' });

    for (let i = 0; i < 10; i++) {
      clock.step();
    }

    assert.equal(clock.tick, 10);
    assert.equal(clock.time, 0.9999999999999999);
  });

  it('refuses a step that is not positive and finite', () => {
    assert.throws(() => createClock({ dt: 0 }), RangeError);
    assert.throws(() => createClock({ dt: Number.POSITIVE_INFINITY }), RangeError);
  });

  it('takes the world rule on the world clock and the 1e-8 snap on the motion clock', () => {
    assert.equal(createClock({ dt: 1 / 60 }).countdown, WORLD_COUNTDOWN);
    assert.equal(createMotionClock({ dt: 1 / 60 }).countdown, MOTION_COUNTDOWN);
    assert.equal(createMotionClock({ dt: 1 / 60 }).kind, 'motion');
  });
});

describe('stamps', () => {
  it('fall due on the tick a countdown of the same length runs out', () => {
    const clock = createClock({ dt: 0.25 });
    const stamp = clock.stampAt(1);
    let left = 1;

    while (!isRunOut(left, clock.countdown)) {
      assert.equal(clock.isDue(stamp), false);
      left = countDown(left, clock.dt, clock.countdown);
      clock.step();
    }

    assert.equal(stamp, 4);
    assert.equal(clock.isDue(stamp), true);
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
    const clock = createMotionClock({ dt: 1 / 60 });

    assert.equal(clock.stampAt(5e-9), 0);
    assert.equal(clock.stampAt(0), 0);
    assert.equal(clock.stampAt(Number.POSITIVE_INFINITY), 0);
  });
});

describe('countdowns', () => {
  it('step the world rule as max(0, t − dt)', () => {
    assert.equal(countDown(0.5, 0.2, WORLD_COUNTDOWN), 0.3);
    assert.equal(countDown(0.1, 0.2, WORLD_COUNTDOWN), 0);
    assert.equal(countDown(5e-9, 0, WORLD_COUNTDOWN), 5e-9);
  });

  it('snap the motion rule to zero below 1e-8', () => {
    assert.equal(countDown(0.5 + 5e-9, 0.5, MOTION_COUNTDOWN), 0);
    assert.equal(countDown(0.5 + 2e-8, 0.5, MOTION_COUNTDOWN) > 0, true);
    assert.equal(countDown(0.5, 0.25, MOTION_COUNTDOWN), 0.25);
  });

  it('run out by each clock epsilon', () => {
    const hexfire = defineCountdown({ snap: true, epsilon: 1e-6 });

    assert.equal(isRunOut(0, WORLD_COUNTDOWN), true);
    assert.equal(isRunOut(1e-12, WORLD_COUNTDOWN), false);
    assert.equal(isRunOut(5e-9, MOTION_COUNTDOWN), true);
    assert.equal(isRunOut(5e-7, hexfire), true);
    assert.equal(isRunOut(2e-6, hexfire), false);
  });

  it('count the steps by walking the float countdown, not by dividing', () => {
    // 0.4 / 0.1 is 4, but walking 0.4 down by 0.1 leaves 2.8e-17 after four steps: the world rule needs a fifth, and
    // the motion rule snaps it to zero on the fourth.
    assert.equal(stepsUntil(0.4, 0.1, WORLD_COUNTDOWN), 5);
    assert.equal(stepsUntil(0.4, 0.1, MOTION_COUNTDOWN), 4);
    assert.equal(stepsUntil(1, 1 / 60, MOTION_COUNTDOWN), 60);
    assert.equal(stepsUntil(1, 0, MOTION_COUNTDOWN), 0);
  });

  it('divide past 120,000 steps', () => {
    assert.equal(stepsUntil(3000, 1 / 60, MOTION_COUNTDOWN), 180_000);
  });
});
