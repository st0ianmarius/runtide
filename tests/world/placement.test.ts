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
});

describe('moveBody: a body swept against static geometry', () => {
  it('stops where it first touches a wall', () => {
    const move = world.moveBody([vec2(0, 0), vec2(10, 0)], 1);

    assert.equal(move.hit, true);
    close(move.share, 0.4);
    close(move.position.x, 4);
  });

  it('stops at the bounds, inset by its radius', () => {
    const move = world.moveBody([vec2(0, 12), vec2(0, 32)], 1);

    assert.equal(move.hit, true);
    close(move.position.z, 19);
  });

  it('goes the whole way when nothing is in the way', () => {
    assert.deepEqual(world.moveBody([vec2(0, 0), vec2(0, 10)], 1), { position: { x: 0, z: 10 }, hit: false, share: 1 });
  });
});

describe('pickPoint: sample and score', () => {
  it('draws twice per attempt, keeps samples in the annulus and the arc, and returns the first that passes', () => {
    let draws = 0;
    const random = stream(7);

    const counted = (): number => {
      draws += 1;

      return random();
    };

    const picked = world.pickPoint({
      centre: vec2(0, 0),
      min: 2,
      max: 4,
      dir: 0,
      half: 0.5,
      attempts: 5,
      random: counted,
    });

    assert.ok(picked !== undefined);
    assert.equal(draws, 2);

    const d = Math.hypot(picked.x, picked.z);

    assert.ok(d >= 2 && d <= 4);
    assert.ok(Math.abs(Math.atan2(picked.x, picked.z)) <= 0.5 + 1e-12);
  });

  it('keeps the best score over every attempt, the first on ties', () => {
    const seen: Vec2[] = [];

    const picked = world.pickPoint({
      centre: vec2(0, 0),
      max: 3,
      attempts: 6,
      random: stream(11),

      score: (p) => {
        seen.push(p);

        return p.x;
      },
    });

    assert.equal(seen.length, 6);
    assert.equal(picked?.x, Math.max(...seen.map((p) => p.x)));
  });

  it('walks a blocked sample back toward the centre, and gives up when no attempt is clear', () => {
    const inWall = {
      centre: vec2(0, 0),
      min: 5.5,
      max: 5.5,
      dir: Math.PI / 2,
      half: 0,
      attempts: 3,
      random: stream(3),
    };

    assert.equal(world.pickPoint(inWall), undefined);

    const walked = world.pickPoint({ ...inWall, walkBack: { step: 1, steps: 2 } });

    close(walked?.x ?? 0, 4.5);
    assert.equal(world.pickPoint({ ...inWall, walkBack: { step: 1, steps: 2 }, filter: (p) => p.x < 4 }), undefined);
  });
});

describe('query extensions', () => {
  it('adds the game’s own queries over the world, listed by name', () => {
    const extended = createMemoryWorld({ bounds: BOUNDS }, (base) => ({
      squareClear: (at: Vec2): boolean => base.isPositionClear(at, 1),
    }));

    assert.equal(extended.squareClear(vec2(0, 0)), true);
    assert.deepEqual(extended.extensions, ['squareClear']);
  });

  it('refuses an extension that would replace a world query', () => {
    assert.throws(() => createMemoryWorld({ bounds: BOUNDS }, () => ({ inside: () => 0 })), RangeError);
  });
});
