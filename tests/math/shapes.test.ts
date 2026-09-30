import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  circle,
  cone,
  covers,
  difference,
  lane,
  outside,
  point,
  polygon,
  ring,
  type Shape,
  union,
  vec2
} from '../../src/math/index.ts';

describe('covers: base shapes', () => {
  it('covers a circle up to, not including, its rim, and reaches by the body radius', () => {
    const disc = circle(2, vec2(10, 0));

    assert.equal(covers(disc, vec2(11, 0)), true);
    assert.equal(covers(disc, vec2(12, 0)), false);
    assert.equal(covers(disc, vec2(13, 0), 1.5), true);
  });

  it('covers a ring from its inner rim, inclusive, to its outer rim, exclusive', () => {
    const band = ring(1, 3);

    assert.equal(covers(band, vec2(0.5, 0)), false);
    assert.equal(covers(band, vec2(1, 0)), true);
    assert.equal(covers(band, vec2(0, -2)), true);
    assert.equal(covers(band, vec2(3, 0)), false);
    assert.equal(covers(band, vec2(0.5, 0), 0.5), true);
  });

  it('covers a point with a body that reaches it', () => {
    assert.equal(covers(point(vec2(1, 1)), vec2(1, 1)), true);
    assert.equal(covers(point(vec2(1, 1)), vec2(1, 2)), false);
    assert.equal(covers(point(vec2(1, 1)), vec2(1, 2), 1), true);
  });

  it('covers a cone within its half-angle, and near the apex at any angle', () => {
    const sector = cone({ r: 5, half: Math.PI / 4, dir: 0, apex: 0.6 });

    assert.equal(covers(sector, vec2(0, 3)), true);
    assert.equal(covers(sector, vec2(1, 3)), true);
    assert.equal(covers(sector, vec2(3, 1)), false);
    assert.equal(covers(sector, vec2(0, -3)), false);
    assert.equal(covers(sector, vec2(0, -0.5)), true);
    assert.equal(covers(sector, vec2(0, 6)), false);
    assert.equal(covers(sector, vec2(3, 2)), false);
    assert.equal(covers(sector, vec2(3, 2), 1), true);
  });

  it('covers a lane along its heading, with the reach behind its start', () => {
    const path = lane({ length: 10, width: 2, dir: 0, at: vec2(0, 1), back: 0.5 });

    assert.equal(covers(path, vec2(0, 6)), true);
    assert.equal(covers(path, vec2(0.9, 11)), true);
    assert.equal(covers(path, vec2(0, 0.6)), true);
    assert.equal(covers(path, vec2(0, 0.4)), false);
    assert.equal(covers(path, vec2(1.5, 5)), false);
    assert.equal(covers(path, vec2(1.5, 5), 0.5), true);
    assert.equal(covers(path, vec2(0, 12)), false);
  });

  it('covers a polygon inside, and a polygon grown by its band just outside', () => {
    const square = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];

    assert.equal(covers(polygon(square), vec2(2, 2)), true);
    assert.equal(covers(polygon(square), vec2(5, 2)), false);
    assert.equal(covers(polygon(square), vec2(5, 2), 1.5), true);
    assert.equal(covers(polygon(square, 1.5), vec2(5, 2)), true);
    assert.equal(covers(polygon(square, 0.5), vec2(5, 2)), false);
  });
});

describe('covers: shape algebra', () => {
  it('covers the outside of a ring of fire, not its inside', () => {
    const burn = outside(circle(5));

    assert.equal(covers(burn, vec2(6, 0)), true);
    assert.equal(covers(burn, vec2(3, 0)), false);
    assert.equal(covers(burn, vec2(4.5, 0), 1), true);
  });

  it('covers a union where any part does', () => {
    const both = union(circle(1), circle(1, vec2(5, 0)));

    assert.equal(covers(both, vec2(0.5, 0)), true);
    assert.equal(covers(both, vec2(5.5, 0)), true);
    assert.equal(covers(both, vec2(2.5, 0)), false);
  });

  it('covers a lane with a gap cut out of it', () => {
    const gapped = difference(lane({ length: 10, width: 2, dir: 0 }), circle(1.5, vec2(0, 5)));

    assert.equal(covers(gapped, vec2(0, 2)), true);
    assert.equal(covers(gapped, vec2(0, 5)), false);
    assert.equal(covers(gapped, vec2(0, 8)), true);
    assert.equal(covers(gapped, vec2(0, 5), 2), true);
  });

  const shapes = fc.oneof(
    fc
      .record({
        r: fc.double({ min: 0.1, max: 5, noNaN: true }),
        x: fc.integer({ min: -5, max: 5 })
      })
      .map(({ r, x }) => circle(r, vec2(x, 0))),
    fc
      .record({
        inner: fc.double({ min: 0, max: 2, noNaN: true }),
        outer: fc.double({ min: 2.1, max: 6, noNaN: true })
      })
      .map(({ inner, outer }) => ring(inner, outer))
  );

  const points = fc.record({
    x: fc.double({ min: -10, max: 10, noNaN: true }),
    z: fc.double({ min: -10, max: 10, noNaN: true })
  });

  it('round-trips the algebra on bare points', () => {
    fc.assert(
      fc.property(shapes, shapes, points, (a: Shape, b: Shape, p) => {
        assert.equal(covers(outside(outside(a)), p), covers(a, p));
        assert.equal(covers(union(a, b), p), covers(a, p) || covers(b, p));
        assert.equal(covers(difference(a, b), p), covers(a, p) && !covers(b, p));
        assert.equal(covers(difference(a, a), p), false);
        assert.equal(covers(union(a, outside(a)), p), true);
      })
    );
  });
});
