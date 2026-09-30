import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { vec2 } from '../../src/math/index.ts';
import { Trail } from '../../src/world/index.ts';

describe('a trail of positions', () => {
  it('answers where a unit stood on a tick, the one before for a tick it skipped, the oldest past its end', () => {
    const trail = new Trail(3);
    const out = { x: 0, z: 0 };

    assert.equal(trail.at(5, out), undefined);

    for (const tick of [1, 2, 4, 5]) {
      trail.record(tick, vec2(tick * 10, 0));
    }

    assert.equal(trail.size, 3);
    assert.deepEqual({ ...trail.at(5, out) }, { x: 50, z: 0 });
    assert.deepEqual({ ...trail.at(3, out) }, { x: 20, z: 0 });
    assert.deepEqual({ ...trail.at(0, out) }, { x: 20, z: 0 });
    assert.deepEqual({ ...trail.at(9, out) }, { x: 50, z: 0 });
    assert.throws(() => {
      trail.record(5, vec2(0, 0));
    }, /in order/);
    trail.clear();
    assert.equal(trail.at(5, out), undefined);
    assert.throws(() => new Trail(0), /from 1/);
  });
});
