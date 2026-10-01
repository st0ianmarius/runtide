import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { createTimingWheel, type TimingWheel } from '../../src/core/index.ts';

/** Collects through a tick into a fresh array, trimmed to what was written. */
const due = <Item extends NonNullable<unknown>>(wheel: TimingWheel<Item>, through: number): Item[] => {
  const out: (Item | undefined)[] = [];
  const count = wheel.collect(through, out);

  return out.slice(0, count).filter((item): item is Item => item !== undefined);
};

describe('the timing wheel', () => {
  it('fires items due on the same tick in scheduling order', () => {
    const wheel = createTimingWheel<string>({ horizon: 8 });

    wheel.schedule(3, 'a');
    wheel.schedule(1, 'b');
    wheel.schedule(3, 'c');
    wheel.schedule(1, 'd');

    assert.deepEqual(due(wheel, 0), []);
    assert.deepEqual(due(wheel, 1), ['b', 'd']);
    assert.deepEqual(due(wheel, 5), ['a', 'c']);
    assert.equal(wheel.cursor, 6);
    assert.equal(wheel.size, 0);
  });

  it('keeps items beyond the horizon in the heap and admits them in order', () => {
    const wheel = createTimingWheel<string>({ horizon: 4 });

    wheel.schedule(10, 'far-1');
    wheel.schedule(9, 'nearer');
    wheel.schedule(10, 'far-2');
    due(wheel, 7);
    wheel.schedule(10, 'late-3');

    assert.equal(wheel.size, 4);
    assert.deepEqual(due(wheel, 9), ['nearer']);
    assert.deepEqual(due(wheel, 10), ['far-1', 'far-2', 'late-3']);
  });

  it('fires a late item at the next collect, after the items already due', () => {
    const wheel = createTimingWheel<number>();

    due(wheel, 4);
    wheel.schedule(5, 1);
    wheel.schedule(2, 2);

    assert.deepEqual(due(wheel, 5), [1, 2]);
  });

  it('writes from index 0, keeps the output storage and clears what an earlier call left past the count', () => {
    const wheel = createTimingWheel<number>();
    const out: (number | undefined)[] = [];

    wheel.schedule(0, 1);
    wheel.schedule(0, 2);
    wheel.schedule(0, 3);
    wheel.schedule(1, 4);

    assert.equal(wheel.collect(0, out), 3);
    assert.deepEqual(out, [1, 2, 3]);
    assert.equal(wheel.collect(1, out), 1);
    assert.deepEqual(out, [4, undefined, undefined]);
    assert.equal(wheel.collect(2, out), 0);
    assert.deepEqual(out, [undefined, undefined, undefined]);
  });

  it('refuses a tick that is not finite, and a start that is not a whole tick from 0', () => {
    assert.throws(() => {
      createTimingWheel<number>().schedule(Number.NaN, 1);
    }, RangeError);

    for (const start of [-3, 2.5, Number.NaN]) {
      assert.throws(() => createTimingWheel<number>({ start }), /whole tick from 0/);
    }
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
          fired.push(...due(wheel, tick));
        }

        const expected = ticks
          .map((tick, index) => ({ tick, index }))
          .toSorted((a, b) => a.tick - b.tick || a.index - b.index)
          .map(({ index }) => index);

        assert.deepEqual(fired, expected);
      })
    );
  });
});
