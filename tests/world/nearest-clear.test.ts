import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { circle, polygon, type Vec2, vec2 } from '../../src/math/index.ts';
import { createMemoryWorld, nearestClear } from '../../src/world/index.ts';

const BOUNDS = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };

/** A pillar of radius 2 at the origin, and a wall along x = 5 from z = −10 to 10. */
const world = createMemoryWorld<object>({
  bounds: BOUNDS,
  statics: [circle(2, vec2(0, 0)), polygon([vec2(5, -10), vec2(6, -10), vec2(6, 10), vec2(5, 10)])]
});

describe('nearestClear: the nearest clear point for a body', () => {
  it('gives the point itself when it is clear, as a new vector', () => {
    const at = vec2(-10, 0);
    const found = nearestClear(world, at, 0.5, { maxDistance: 3 });

    assert.deepEqual(found, at);
    assert.notEqual(found, at);
  });

  it('finds a clear point on the nearest ring, exactly clear, for a body caught in a pillar', () => {
    const found = nearestClear(world, vec2(0.5, 0), 0.5, { maxDistance: 5, step: 0.25 });

    assert.ok(found !== undefined);
    assert.equal(world.isPositionClear(found, 0.5), true);

    const distance = Math.hypot(found.x - 0.5, found.z);

    // Out of the pillar (2 + 0.5 from its centre) on the first ring that clears it, and no ring sooner.
    assert.ok(distance <= 3.25 + 1e-9, `${distance}`);
    assert.equal(nearestClear(world, vec2(0.5, 0), 0.5, { maxDistance: distance - 0.25, step: 0.25 }), undefined);
  });

  it('draws no random number: the same arguments give the same point, and the candidates are bounded', () => {
    let asked = 0;

    const counting = {
      isPositionClear: (p: Vec2, radius: number): boolean => {
        asked += 1;

        return world.isPositionClear(p, radius);
      }
    };

    const a = nearestClear(counting, vec2(5.5, 0), 1, { maxDistance: 4 });

    assert.deepEqual(nearestClear(world, vec2(5.5, 0), 1, { maxDistance: 4 }), a);

    asked = 0;
    assert.equal(nearestClear(counting, vec2(5.5, 0), 0.1, { maxDistance: 0.5, step: 0.1 }), undefined);

    // 1 + ⌈2π⌉ + ⌈4π⌉ + ⌈6π⌉ + ⌈8π⌉ + ⌈10π⌉ candidates for 5 rings.
    assert.equal(asked, 1 + 7 + 13 + 19 + 26 + 32);
  });

  it('gives undefined when nothing within the distance is clear, and refuses input out of range', () => {
    assert.equal(nearestClear(world, vec2(0, 0), 0.5, { maxDistance: 1 }), undefined);
    assert.equal(nearestClear(world, vec2(0, 0), 0.5, { maxDistance: 0 }), undefined);

    for (const call of [
      () => nearestClear(world, vec2(Number.NaN, 0), 0.5, { maxDistance: 1 }),
      () => nearestClear(world, vec2(0, 0), Number.NaN, { maxDistance: 1 }),
      () => nearestClear(world, vec2(0, 0), 0.5, { maxDistance: Number.POSITIVE_INFINITY }),
      () => nearestClear(world, vec2(0, 0), 0.5, { maxDistance: 1, step: 0 })
    ]) {
      assert.throws(call, RangeError);
    }
  });
});
