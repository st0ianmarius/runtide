import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { vec2 } from '../../src/math/index.ts';
import { Trail } from '../../src/world/index.ts';

describe('a trail of positions', () => {
  it('answers where a unit stood at a tick, between records on the line, the oldest past its end', () => {
    const trail = new Trail(3);
    const out = { x: 0, z: 0 };

    assert.equal(trail.at(5, out), undefined);

    for (const tick of [1, 2, 4, 5]) {
      trail.record(tick, vec2(tick * 10, 0));
    }

    assert.equal(trail.size, 3);
    assert.deepEqual({ ...trail.at(5, out) }, { x: 50, z: 0 });
    assert.deepEqual({ ...trail.at(3, out) }, { x: 30, z: 0 });
    assert.deepEqual({ ...trail.at(4.5, out) }, { x: 45, z: 0 });
    assert.deepEqual([trail.oldest, trail.newest], [2, 5]);
    assert.deepEqual({ ...trail.at(0, out) }, { x: 20, z: 0 });
    assert.deepEqual({ ...trail.at(9, out) }, { x: 50, z: 0 });
    assert.throws(() => {
      trail.record(5, vec2(0, 0));
    }, /in order/);
    trail.clear();
    assert.equal(trail.at(5, out), undefined);
    assert.throws(() => new Trail(0), /from 1/);
  });

  it('records a first tick of -1 or below, and refuses a tick that is not finite or a read at NaN', () => {
    const trail = new Trail(4);
    const out = { x: 0, z: 0 };

    trail.record(-5, vec2(0, 0));
    trail.record(-1, vec2(4, 0));
    assert.deepEqual([trail.size, trail.oldest, trail.newest], [2, -5, -1]);
    assert.deepEqual({ ...trail.at(-3, out) }, { x: 2, z: 0 });
    assert.throws(() => {
      trail.record(-2, vec2(0, 0));
    }, /in order/);
    assert.throws(() => {
      trail.record(Number.NaN, vec2(0, 0));
    }, RangeError);
    assert.throws(() => trail.at(Number.NaN, out), RangeError);

    trail.clear();
    trail.record(-1, vec2(1, 1));
    assert.equal(trail.newest, -1);
  });
});
