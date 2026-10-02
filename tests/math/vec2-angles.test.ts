import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addVec,
  angleDelta,
  cross,
  directionOf,
  distance,
  distanceSq,
  dot,
  headingOf,
  lengthOf,
  lerp,
  normalize,
  ORIGIN,
  scale,
  sub,
  turnToward,
  vec2,
  wrap
} from '../../src/math/index.ts';

/** Asserts two numbers agree within 1e-12: results through Math.sin, cos or atan2 may differ in the last bit. */
const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not close to ${expected}`);
};

describe('Vec2', () => {
  it('adds, subtracts, scales and interpolates', () => {
    assert.deepEqual(addVec(vec2(1, 2), vec2(3, -4)), { x: 4, z: -2 });
    assert.deepEqual(sub(vec2(1, 2), vec2(3, -4)), { x: -2, z: 6 });
    assert.deepEqual(scale(vec2(1.5, -2), 2), { x: 3, z: -4 });
    assert.deepEqual(lerp(vec2(0, 0), vec2(4, 8), 0.25), { x: 1, z: 2 });
  });

  it('measures lengths, distances and products', () => {
    assert.equal(lengthOf(vec2(3, 4)), 5);
    assert.equal(distance(vec2(1, 1), vec2(4, 5)), 5);
    assert.equal(distanceSq(vec2(1, 1), vec2(4, 5)), 25);
    assert.equal(dot(vec2(1, 2), vec2(3, 4)), 11);
    assert.equal(cross(vec2(1, 0), vec2(0, 1)), 1);
  });

  it('normalises, and leaves a zero vector at the origin', () => {
    assert.deepEqual(normalize(vec2(0, -3)), { x: 0, z: -1 });
    assert.equal(normalize(vec2(0, 0)), ORIGIN);
  });

  it('normalises a vector whose squared length overflows or underflows, and gives NaN for a non-finite one', () => {
    assert.deepEqual(normalize(vec2(3e200, -4e200)), { x: 0.6, z: -0.8 });
    close(normalize(vec2(1e200, 1e200)).x, Math.SQRT1_2);
    assert.deepEqual(normalize(vec2(1e-200, 0)), { x: 1, z: 0 });
    assert.deepEqual(normalize(vec2(0, -5e-324)), { x: 0, z: -1 });
    assert.deepEqual(normalize(vec2(3e-160, 4e-160)), { x: 0.6, z: 0.8 });
    assert.deepEqual(normalize(vec2(Number.NaN, 1)), { x: Number.NaN, z: Number.NaN });
    assert.deepEqual(normalize(vec2(Number.POSITIVE_INFINITY, 1)), { x: Number.NaN, z: Number.NaN });
  });
});

describe('angles', () => {
  it('wrap into (−π, π]', () => {
    assert.equal(wrap(0), 0);
    assert.equal(wrap(Math.PI), Math.PI);
    assert.equal(wrap(-Math.PI), Math.PI);
    close(wrap(Math.PI * 1.5), -Math.PI / 2);
    close(wrap(Math.PI * 4 + 1), 1);
  });

  it('take the shortest turn', () => {
    close(angleDelta(Math.PI * 0.9, -Math.PI * 0.9), Math.PI * 0.2);
    close(angleDelta(0, Math.PI / 2), Math.PI / 2);
  });

  it('turn toward a heading by a share of the shortest turn, across the seam', () => {
    close(turnToward(0, 1, 0.5), 0.5);
    close(Math.abs(turnToward(Math.PI * 0.9, -Math.PI * 0.9, 0.5)), Math.PI);
    assert.ok(turnToward(Math.PI * 0.9, -Math.PI * 0.9, 1) < 0);
  });

  it('convert between headings and directions: 0 faces +z, π/2 faces +x', () => {
    assert.equal(headingOf(vec2(0, 1)), 0);
    assert.equal(headingOf(vec2(1, 0)), Math.PI / 2);
    assert.deepEqual(directionOf(0), { x: 0, z: 1 });
    close(directionOf(Math.PI / 2).x, 1);
    close(directionOf(Math.PI / 2).z, 0);
  });
});
