import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stream } from '../../src/core/index.ts';
import { circle, polygon, type Vec2, vec2 } from '../../src/math/index.ts';
import { createMemoryWorld } from '../../src/world/index.ts';

const BOUNDS = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };

/** A wall along x = 5 from z = −10 to 10, one unit thick, and a pillar at (−5, 0). */
const STATICS = [polygon([vec2(5, -10), vec2(6, -10), vec2(6, 10), vec2(5, 10)]), circle(1, vec2(-5, 0))];

const world = createMemoryWorld<object>({ bounds: BOUNDS, statics: STATICS });

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
};

describe('static geometry: clearance and lines of sight', () => {
  it('tells a clear position from one inside a wall, a pillar or past the bounds', () => {
    assert.equal(world.isPositionClear(vec2(0, 0), 1), true);
    assert.equal(world.isPositionClear(vec2(5.5, 0), 0), false);
    assert.equal(world.isPositionClear(vec2(4.5, 0), 1), false);
    assert.equal(world.isPositionClear(vec2(-5, 1.5), 0.4), true);
    assert.equal(world.isPositionClear(vec2(19.5, 0), 1), false);
    assert.equal(world.isPositionClear(vec2(19, 0), 1), true);
  });

  it('sees past nothing, but not through the wall or the pillar', () => {
    assert.equal(world.lineClear(vec2(0, 0), vec2(4, 0)), true);
    assert.equal(world.lineClear(vec2(0, 0), vec2(10, 0)), false);
    assert.equal(world.lineClear(vec2(0, 0), vec2(0, 15)), true);
    assert.equal(world.lineClear(vec2(0, 0), vec2(-10, 0)), false);
    assert.equal(world.lineClear(vec2(0, 2), vec2(-10, 2)), true);
    assert.equal(world.lineClear(vec2(0, 2), vec2(-10, 2), 1.5), false);
  });

  it('clamps a point into the bounds, inset by a radius', () => {
    assert.deepEqual(world.clamp(vec2(30, -30)), { x: 20, z: -20 });
    assert.deepEqual(world.clamp(vec2(30, 0), 2), { x: 18, z: 0 });
  });

  it('clamps a body wider than the bounds to their middle on that axis', () => {
    const strip = createMemoryWorld<object>({ bounds: { minX: 0, minZ: 0, maxX: 4, maxZ: 40 } });

    assert.deepEqual(strip.clamp(vec2(30, 30), 3), { x: 2, z: 30 });
    assert.deepEqual(strip.clamp(vec2(-9, -9), 2), { x: 2, z: 2 });
  });

  it('refuses a point that is not finite or a radius that is not a finite number from 0, wherever a body is tested', () => {
    const bad: [string, () => unknown][] = [
      ['NaN radius move', () => world.moveBody(vec2(-10, 0), vec2(10, 0), Number.NaN)],
      ['negative radius move', () => world.moveBody(vec2(0, 0), vec2(10, 0), -1)],
      ['NaN start', () => world.moveBody(vec2(Number.NaN, 0), vec2(10, 0), 1)],
      ['infinite end', () => world.moveBody(vec2(0, 0), vec2(Number.POSITIVE_INFINITY, 0), 1)],
      ['NaN radius line', () => world.lineClear(vec2(0, 0), vec2(10, 0), Number.NaN)],
      ['NaN line end', () => world.lineClear(vec2(0, 0), vec2(10, Number.NaN))],
      ['negative radius line', () => world.lineClear(vec2(0, 0), vec2(10, 0), -0.5)],
      ['NaN radius clear', () => world.isPositionClear(vec2(0, 0), Number.NaN)],
      ['infinite radius clear', () => world.isPositionClear(vec2(0, 0), Number.POSITIVE_INFINITY)],
      ['NaN position clear', () => world.isPositionClear(vec2(0, Number.NaN), 1)],
      ['NaN clamp', () => world.clamp(vec2(Number.NaN, 0))],
      ['negative clamp radius', () => world.clamp(vec2(0, 0), -1)]
    ];

    for (const [name, call] of bad) {
      assert.throws(call, RangeError, name);
    }

    assert.throws(() => world.pickPoint({ attempts: 1, sample: () => vec2(Number.NaN, 0) }), RangeError);
  });
});

describe('moveBody: a body swept against static geometry', () => {
  it('stops where it first touches a wall, with the wall’s normal toward it', () => {
    const move = world.moveBody(vec2(0, 0), vec2(10, 0), 1);

    assert.equal(move.hit, true);
    close(move.share, 0.4);
    close(move.position.x, 4);
    assert.deepEqual(move.normal, { x: -1, z: 0 });

    const pillar = world.moveBody(vec2(-5, 5), vec2(-5, -5), 1);

    close(pillar.normal?.x ?? Number.NaN, 0);
    close(pillar.normal?.z ?? Number.NaN, 1);
  });

  it('slides along two walls lying flush, past their seam, and gives a body of no radius a real normal', () => {
    const box = (x0: number, x1: number): ReturnType<typeof polygon> =>
      polygon([vec2(x0, 1), vec2(x1, 1), vec2(x1, 2), vec2(x0, 2)]);

    const flush = createMemoryWorld<object>({
      bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
      statics: [box(-40, 0), box(0, 40)]
    });

    let at: Vec2 = vec2(-30, 0);

    // Pressed up into the walls while moving right, sliding along the normal each hit gives.
    for (let i = 0; i < 400; i++) {
      const to = vec2(at.x + 0.13, at.z + 0.05);
      const move = flush.moveBody(at, to, 0.5);
      const normal = move.normal ?? vec2(0, 0);
      const into = (to.x - move.position.x) * normal.x + (to.z - move.position.z) * normal.z;

      at = move.hit
        ? flush.moveBody(move.position, vec2(to.x - into * normal.x, to.z - into * normal.z), 0.5).position
        : move.position;
    }

    assert.ok(at.x > 20, `the body stuck at x = ${at.x}`);

    const point = flush.moveBody(vec2(0.5, 0), vec2(0.5, 3), 0);

    assert.deepEqual([point.hit, point.normal], [true, { x: 0, z: -1 }]);
  });

  it('stops at the bounds, inset by its radius, with the bound’s normal', () => {
    const move = world.moveBody(vec2(0, 12), vec2(0, 32), 1);

    assert.equal(move.hit, true);
    close(move.position.z, 19);
    assert.deepEqual(move.normal, { x: 0, z: -1 });
  });

  it('lets a body that starts in a wall leave it, and stops one that heads further in', () => {
    const out = world.moveBody(vec2(4.5, 0), vec2(0, 0), 1);
    const deeper = world.moveBody(vec2(4.5, 0), vec2(8, 0), 1);

    assert.deepEqual([out.hit, out.share], [false, 1]);
    assert.deepEqual([deeper.hit, deeper.share], [true, 0]);
  });

  it('lets a body that starts past the bounds come back in, but not out through the far side', () => {
    const small = createMemoryWorld<string>({ bounds: { minX: -5, minZ: -5, maxX: 5, maxZ: 5 } });
    const across = small.moveBody(vec2(-6, 0), vec2(10, 0), 1);
    const back = small.moveBody(vec2(6, 0), vec2(-10, 0), 1);
    const into = small.moveBody(vec2(-6, 0), vec2(0, 0), 1);

    assert.deepEqual([across.hit, across.position.x], [true, 4]);
    assert.deepEqual([back.hit, back.position.x], [true, -4]);
    assert.deepEqual([into.hit, into.share], [false, 1]);
  });

  it('never sticks a body that slides along what stopped it: a bound, a pillar or a wall', () => {
    const boxed = createMemoryWorld<string>({ bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 } });

    const walled = createMemoryWorld<string>({
      bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
      statics: [circle(2, vec2(0, 0)), polygon([vec2(-10, 20), vec2(10, 20), vec2(10, 21), vec2(-10, 21)])]
    });

    for (let i = 0; i < 500; i++) {
      const radius = 0.37 + (i % 7) * 0.1;

      const stop = boxed.moveBody(
        vec2(Math.max(0.1 + ((i * 0.00731) % 9), radius), 5),
        vec2(10.3 + ((i * 0.0137) % 5), 5.1),
        radius
      );

      assert.ok(boxed.moveBody(stop.position, vec2(stop.position.x, 6), radius).share > 0);

      const angle = (i / 500) * Math.PI * 2;
      const pillar = walled.moveBody(vec2(Math.sin(angle) * 8, Math.cos(angle) * 8), vec2(0, 0), 0.5);
      const normal = pillar.normal ?? vec2(0, 0);
      const along = vec2(pillar.position.x - normal.z, pillar.position.z + normal.x);

      assert.ok(walled.moveBody(pillar.position, along, 0.5).share > 0.01);

      const from = vec2(-5 + i * 0.013, 16.7 - i * 0.0017);
      const wall = walled.moveBody(from, vec2(from.x + 0.3, 23), 0.5);

      assert.ok(walled.moveBody(wall.position, vec2(wall.position.x + 1, wall.position.z), 0.5).share > 0.01);
    }
  });

  it('reads new static geometry once it is put in', () => {
    const doors = createMemoryWorld<object>({ bounds: BOUNDS, statics: STATICS });

    assert.equal(doors.lineClear(vec2(0, 0), vec2(10, 0)), false);
    doors.setStatics([circle(1, vec2(-5, 0))]);
    assert.equal(doors.lineClear(vec2(0, 0), vec2(10, 0)), true);
    doors.setStatics([]);
    assert.equal(doors.isPositionClear(vec2(-5, 0), 0), true);
  });

  it('goes the whole way when nothing is in the way', () => {
    assert.deepEqual(world.moveBody(vec2(0, 0), vec2(0, 10), 1), {
      position: { x: 0, z: 10 },
      hit: false,
      share: 1
    });
  });
});

describe('pickPoint: the game’s samples, cleared, filtered and scored', () => {
  it('asks the sampler once per attempt, skips a candidate not clear, filtered or missing, and keeps the first that passes', () => {
    const candidates = [undefined, vec2(5.5, 0), vec2(3, 0), vec2(1, 0), vec2(0, 1)];
    const asked: number[] = [];

    const picked = world.pickPoint({
      attempts: candidates.length,
      filter: (p) => p.x < 2,

      sample: (attempt) => {
        asked.push(attempt);

        return candidates[attempt];
      }
    });

    assert.deepEqual(picked, vec2(1, 0));
    assert.deepEqual(asked, [0, 1, 2, 3]);
  });

  it('keeps the best score over every attempt, the first on ties, and needs its clearance', () => {
    const random = stream(11);
    const seen: Vec2[] = [];

    const picked = world.pickPoint({
      attempts: 6,
      sample: () => vec2(random() * 6 - 3, random() * 6 - 3),

      score: (p) => {
        seen.push(p);

        return p.x;
      }
    });

    assert.equal(seen.length, 6);
    assert.equal(picked?.x, Math.max(...seen.map((p) => p.x)));
    assert.equal(world.pickPoint({ attempts: 3, clearance: 1, sample: () => vec2(4.5, 0) }), undefined);
  });
});

describe('query extensions', () => {
  it('adds the game’s own queries over the world, listed by name', () => {
    const extended = createMemoryWorld({ bounds: BOUNDS }, (base) => ({
      squareClear: (at: Vec2): boolean => base.isPositionClear(at, 1)
    }));

    assert.equal(extended.squareClear(vec2(0, 0)), true);
    assert.deepEqual(extended.extensions, ['squareClear']);
  });

  it('refuses an extension that would replace a world query', () => {
    assert.throws(() => createMemoryWorld({ bounds: BOUNDS }, () => ({ inside: () => 0 })), RangeError);
  });
});
