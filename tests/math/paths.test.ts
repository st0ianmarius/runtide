import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  boundsOf,
  circle,
  cone,
  covers,
  difference,
  lane,
  outside,
  pathIntervals,
  point,
  polygon,
  ring,
  type Shape,
  type TickPath,
  union,
  vec2
} from '../../src/math/index.ts';

/** The seconds a body on `path` spends inside `shape`: the sum of its intervals. */
const secondsInside = (shape: Shape, path: TickPath): number => {
  const out: number[] = [];
  const count = pathIntervals(shape, path, out);
  let seconds = 0;

  for (let i = 0; i < count; i++) {
    seconds += (out[i * 2 + 1] ?? 0) - (out[i * 2] ?? 0);
  }

  return seconds;
};

const close = (actual: number | undefined, expected: number): void => {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
};

describe('boundsOf', () => {
  it('boxes a circle, a ring and a point, grown by the body radius', () => {
    assert.deepEqual(boundsOf(circle(2, vec2(1, 1))), { minX: -1, minZ: -1, maxX: 3, maxZ: 3 });
    assert.deepEqual(boundsOf(ring(1, 3), 1), { minX: -4, minZ: -4, maxX: 4, maxZ: 4 });
    assert.deepEqual(boundsOf(point(vec2(5, 5)), 1), { minX: 4, minZ: 4, maxX: 6, maxZ: 6 });
  });

  it('boxes an axis-aligned lane by its corners, its back included', () => {
    assert.deepEqual(boundsOf(lane({ length: 10, width: 2, dir: 0, back: 1 })), {
      minX: -1,
      minZ: -1,
      maxX: 1,
      maxZ: 10
    });
  });

  it('boxes a polygon with its band, a union by its parts, a difference by its base, and outside everywhere', () => {
    const square = polygon([vec2(0, 0), vec2(2, 0), vec2(2, 2), vec2(0, 2)], 1);

    assert.deepEqual(boundsOf(square), { minX: -1, minZ: -1, maxX: 3, maxZ: 3 });
    assert.deepEqual(boundsOf(union(circle(1), circle(1, vec2(10, 0)))), {
      minX: -1,
      minZ: -1,
      maxX: 11,
      maxZ: 1
    });
    assert.deepEqual(boundsOf(difference(circle(2), circle(1))), {
      minX: -2,
      minZ: -2,
      maxX: 2,
      maxZ: 2
    });
    assert.equal(boundsOf(outside(circle(1))).maxX, Number.POSITIVE_INFINITY);
  });

  it('writes into a reused box', () => {
    const box = boundsOf(circle(1));

    assert.equal(boundsOf(circle(5), 0, box), box);
    assert.equal(box.maxX, 5);
  });
});

describe('pathIntervals: a body crossing a shape over one tick', () => {
  const across = { from: vec2(-10, 0), to: vec2(10, 0), t0: 0, t1: 2 };

  it('finds when a point is inside a circle, to the solved crossing', () => {
    const out: number[] = [];

    assert.equal(pathIntervals(circle(5), across, out), 1);
    close(out[0], 0.5);
    close(out[1], 1.5);
    close(secondsInside(circle(5), across), 1);
  });

  it('widens the time inside by the body radius', () => {
    close(secondsInside(circle(5), { ...across, radius: 5 }), 2);
  });

  it('splits a ring into its two crossings of the band', () => {
    const out: number[] = [];

    assert.equal(pathIntervals(ring(2, 4), across, out), 2);
    close(out[0], 0.6);
    close(out[1], 0.8);
    close(out[2], 1.2);
    close(out[3], 1.4);
  });

  it('clips to a lane and to a polygon, and joins a union of touching shapes', () => {
    close(secondsInside(lane({ length: 4, width: 20, dir: Math.PI / 2 }), across), 0.4);
    close(secondsInside(polygon([vec2(-2, -1), vec2(2, -1), vec2(2, 1), vec2(-2, 1)]), across), 0.4);

    const out: number[] = [];

    assert.equal(pathIntervals(union(circle(2, vec2(-2, 0)), circle(2, vec2(2, 0))), across, out), 1);
    close(out[0], 0.6);
    close(out[1], 1.4);
  });

  it('counts outside a ring of fire and a lane with a gap', () => {
    close(secondsInside(outside(circle(5)), across), 1);
    close(
      secondsInside(difference(lane({ length: 20, width: 2, dir: Math.PI / 2, at: vec2(-10, 0) }), circle(2)), across),
      1.6
    );
  });

  it('holds a whole tick for a body that stands inside, and none for one that stands outside', () => {
    close(secondsInside(circle(1), { from: vec2(0, 0), to: vec2(0, 0), t0: 3, t1: 4 }), 1);
    close(secondsInside(circle(1), { from: vec2(5, 0), to: vec2(5, 0), t0: 3, t1: 4 }), 0);
  });

  it('agrees with covers for a body a rounding short of a ring inner rim (fast-check seed -148015370)', () => {
    const shape = ring(1, 3);
    const radius = 0.9999999999999989;
    const from = vec2(0, -1.0547118733938987e-15);
    const out: number[] = [];

    // 1.05e-15 + radius is just under 1 but rounds to it, so the rim test must not add the reach to the distance.
    assert.equal(covers(shape, from, radius), false);
    assert.equal(pathIntervals(shape, { from, to: vec2(0, 0), t0: 0, t1: 1, radius }, out), 0);
    assert.equal(covers(shape, vec2(0, -1.2e-15), radius), true);
  });

  it('finds a ring inner rim shrunk by the reach to a hair, across a long segment (fast-check seed 675909895)', () => {
    const out: number[] = [];

    const path = {
      from: vec2(0, 4.675661512726095),
      to: vec2(0, -5.943511983007753),
      t0: 0,
      t1: 1,
      radius: 0.9999999578531515
    };

    // Solving the inner rim as b² − a(o·o − r²) lost r² ≈ 2e-15 against o·o ≈ 22, dropping both crossings.
    assert.equal(pathIntervals(ring(1, 3), path, out), 2);
    close(out[0], 0.06362656709059182);
    close(out[3], 0.8169808576971277);
  });

  it('grows a cone apex by the body radius, behind the tip too (fast-check seed 459037742)', () => {
    const sector = cone({ r: 5, half: 0.6, dir: 0.3, apex: 0.5 });
    const out: number[] = [];

    // Facing away from the cone, 0.56 from its apex, a body reaching 1 overlaps the apex disc.
    assert.equal(covers(sector, vec2(-0.56, 0), 1), true);
    assert.equal(covers(sector, vec2(-1.49, 0), 1), true);
    assert.equal(covers(sector, vec2(-1.51, 0), 1), false);
    assert.equal(pathIntervals(sector, { from: vec2(-3, 0), to: vec2(-0.56, 0), t0: 0, t1: 1, radius: 1 }, out), 1);
    close(out[0], 1.5 / 2.44);
    close(out[1], 1);
  });

  it('finds where covers stops seeing a sampled body, outside two discs it sits inside both of', () => {
    const twin = outside(union(circle(2, vec2(-1, 0)), circle(2, vec2(1, 0))));
    const path = { from: vec2(1.4, -3.1), to: vec2(-3, 3.4), t0: 0, t1: 1, radius: 1.8 };
    const out: number[] = [];
    const count = pathIntervals(twin, path, out);

    // Mid-path the body lies within the two discs together, and no sample of it is outside them.
    assert.equal(covers(twin, vec2(-0.712, 0.02), 1.8), false);
    assert.equal(count, 2);
    assert.ok((out[1] ?? 1) < 0.48 && (out[2] ?? 0) > 0.48, `${out.slice(0, 4).join(', ')} spans the middle`);
  });

  it('agrees with covers at every sampled point of any segment, for any shape', () => {
    const shapes: Shape[] = [
      circle(3, vec2(1, 2)),
      ring(1, 3),
      cone({ r: 5, half: 0.6, dir: 0.3, apex: 0.5 }),
      lane({ length: 6, width: 2, dir: 1, back: 1 }),
      polygon([vec2(0, 0), vec2(4, 1), vec2(3, 4), vec2(-1, 3)], 0.5),
      difference(circle(4), ring(1, 2)),
      difference(circle(5), lane({ length: 10, width: 0.5, dir: 0, at: vec2(0, -5) })),
      outside(union(circle(2, vec2(-1, 0)), circle(2, vec2(1, 0)))),
      outside(
        union(
          lane({ length: 4, width: 4, dir: Math.PI / 2, at: vec2(-4, 0) }),
          lane({ length: 4, width: 4, dir: Math.PI / 2 })
        )
      )
    ];

    const coordinate = fc.double({ min: -8, max: 8, noNaN: true });

    fc.assert(
      fc.property(
        fc.constantFrom(...shapes),
        fc.tuple(coordinate, coordinate, coordinate, coordinate),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (shape, [ax, az, bx, bz], radius) => {
          const out: number[] = [];
          const path = { from: vec2(ax, az), to: vec2(bx, bz), t0: 0, t1: 1, radius };
          const count = pathIntervals(shape, path, out);

          const isInside = (t: number) =>
            Array.from({ length: count }, (_unused, i) => i).some(
              (i) => (out[i * 2] ?? 0) <= t && t <= (out[i * 2 + 1] ?? 0)
            );

          const isNearEdge = (t: number) => out.slice(0, count * 2).some((edge) => Math.abs(edge - t) < 1e-6);

          const coversAt = (t: number) => covers(shape, vec2(ax + (bx - ax) * t, az + (bz - az) * t), radius);

          // A sample a rim passes within a hair of is skipped too: pathIntervals joins gaps under 1e-12 of the path
          // (a body of radius a rounding short of a ring's inner radius, crossing its centre), which covers still sees.
          const isOnSliver = (t: number) => coversAt(t - 1e-9) !== coversAt(t) || coversAt(t + 1e-9) !== coversAt(t);

          for (let k = 0; k <= 64; k++) {
            const t = k / 64;

            if (!isNearEdge(t) && !isOnSliver(t)) {
              assert.equal(isInside(t), coversAt(t));
            }
          }
        }
      )
    );
  });
});
