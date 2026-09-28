import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { createTimingWheel } from '../../src/core/index.ts';

describe('the timing wheel', () => {
  it('fires items due on the same tick in scheduling order', () => {
    const wheel = createTimingWheel<string>({ horizon: 8 });

    wheel.schedule(3, 'a');
    wheel.schedule(1, 'b');
    wheel.schedule(3, 'c');
    wheel.schedule(1, 'd');

    assert.deepEqual(wheel.collect(0, []), []);
    assert.deepEqual(wheel.collect(1, []), ['b', 'd']);
    assert.deepEqual(wheel.collect(5, []), ['a', 'c']);
    assert.equal(wheel.cursor, 6);
    assert.equal(wheel.size, 0);
  });

  it('keeps items beyond the horizon in the heap and admits them in order', () => {
    const wheel = createTimingWheel<string>({ horizon: 4 });

    wheel.schedule(10, 'far-1');
    wheel.schedule(9, 'nearer');
    wheel.schedule(10, 'far-2');
    wheel.collect(7, []);
    wheel.schedule(10, 'late-3');

    assert.equal(wheel.size, 4);
    assert.deepEqual(wheel.collect(9, []), ['nearer']);
    assert.deepEqual(wheel.collect(10, []), ['far-1', 'far-2', 'late-3']);
  });

  it('fires a late item at the next collect, after the items already due', () => {
    const wheel = createTimingWheel<number>();

    wheel.collect(4, []);
    wheel.schedule(5, 1);
    wheel.schedule(2, 2);

    assert.deepEqual(wheel.collect(5, []), [1, 2]);
  });

  it('empties the output list before filling it', () => {
    const wheel = createTimingWheel<number>();
    const out = [99];

    wheel.schedule(0, 1);

    assert.equal(wheel.collect(0, out), out);
    assert.deepEqual(out, [1]);
  });

  it('refuses a tick that is not finite', () => {
    assert.throws(() => {
      createTimingWheel<number>().schedule(Number.NaN, 1);
    }, RangeError);
  });

  it('orders any schedule by tick, then by scheduling order', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 40 }), { maxLength: 60 }), (ticks) => {
        const wheel = createTimingWheel<number>({ horizon: 8 });

        for (const [index, tick] of ticks.entries()) {
          wheel.schedule(tick, index);
        }

        const fired: number[] = [];

        for (let tick = 0; tick <= 40; tick++) {
          fired.push(...wheel.collect(tick, []));
        }

        const expected = ticks
          .map((tick, index) => ({ tick, index }))
          .toSorted((a, b) => a.tick - b.tick || a.index - b.index)
          .map(({ index }) => index);

        assert.deepEqual(fired, expected);
      }),
    );
  });
});
