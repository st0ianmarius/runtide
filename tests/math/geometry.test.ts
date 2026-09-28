import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  crossPoints,
  fan,
  inPolygon,
  linePoints,
  polygonArea,
  polygonCentroid,
  polygonEdgeDistanceSq,
  ringPoints,
  segmentDistanceSq,
  segmentIntersection,
  segmentTouchesCircle,
  sweepCircle,
  vec2,
} from '../../src/math/index.ts';

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not close to ${expected}`);
};

describe('segment-circle sweep', () => {
  const target = { at: vec2(0, 0), r: 1 };

  it('finds the earliest contact along the segment', () => {
    assert.equal(sweepCircle(vec2(-5, 0), vec2(5, 0), target), 0.4);
  });

  it('reports an initial overlap as contact at 0', () => {
    assert.equal(sweepCircle(vec2(0.5, 0), vec2(5, 0), target), 0);
  });

  it('misses a circle beside the path, beyond its end, or with a zero-length segment', () => {
    assert.equal(sweepCircle(vec2(-5, 2), vec2(5, 2), target), undefined);
    assert.equal(sweepCircle(vec2(-5, 0), vec2(-3, 0), target), undefined);
    assert.equal(sweepCircle(vec2(3, 0), vec2(5, 0), target), undefined);
    assert.equal(sweepCircle(vec2(-5, 0), vec2(-5, 0), target), undefined);
  });

  it('tests whether a segment passes within a circle, rim included', () => {
    assert.equal(segmentTouchesCircle(vec2(-5, 1), vec2(5, 1), target), true);
    assert.equal(segmentTouchesCircle(vec2(-5, 1.5), vec2(5, 1.5), target), false);
    assert.equal(segmentTouchesCircle(vec2(2, 0), vec2(2, 0), { at: vec2(0, 0), r: 2 }), true);
  });
});

describe('polygons and segments', () => {
  const square = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];

  it('measure the area and centroid, whatever the winding', () => {
    assert.equal(polygonArea(square), 16);
    assert.equal(polygonArea(square.toReversed()), 16);
    assert.deepEqual(polygonCentroid(square), { x: 2, z: 2 });
    assert.deepEqual(polygonCentroid([vec2(0, 0), vec2(2, 0), vec2(4, 0)]), { x: 2, z: 0 });
  });

  it('tell inside from outside by the even-odd rule', () => {
    assert.equal(inPolygon(vec2(1, 1), square), true);
    assert.equal(inPolygon(vec2(5, 1), square), false);
    assert.equal(inPolygon(vec2(2, 2), [vec2(0, 0), vec2(4, 0), vec2(0, 4), vec2(4, 4)]), false);
  });

  it('measure the distance to the nearest edge and to a segment', () => {
    assert.equal(polygonEdgeDistanceSq(vec2(2, 1), square), 1);
    assert.equal(polygonEdgeDistanceSq(vec2(7, 8), square), 25);
    assert.equal(segmentDistanceSq(vec2(3, 3), vec2(0, 0), vec2(0, 0)), 18);
  });

  it('find where two segments cross, and never for parallel ones', () => {
    assert.deepEqual(segmentIntersection(vec2(0, 0), vec2(4, 0), [vec2(1, -1), vec2(1, 3)]), {
      t: 0.25,
      u: 0.25,
      point: { x: 1, z: 0 },
    });
    assert.equal(segmentIntersection(vec2(0, 0), vec2(4, 0), [vec2(5, -1), vec2(5, 3)]), undefined);
    assert.equal(segmentIntersection(vec2(0, 0), vec2(4, 0), [vec2(0, 1), vec2(4, 1)]), undefined);
  });
});

describe('patterns', () => {
  it('march a line outward with a stagger, accumulating the distance', () => {
    assert.deepEqual(linePoints({ from: vec2(1, 1), dir: 0, length: 5, spacing: 2, first: 1, stagger: 0.1 }), [
      { x: 1, z: 2, delay: 0 },
      { x: 1, z: 4, delay: 0.1 },
      { x: 1, z: 6, delay: 0.2 },
    ]);
  });

  it('space points evenly on a ring', () => {
    const points = ringPoints({ at: vec2(0, 0), r: 2, count: 4, stagger: 0.5 });

    assert.equal(points.length, 4);
    assert.deepEqual(points[0], { x: 0, z: 2, delay: 0 });
    close(points[1]?.x ?? 0, 2);
    close(points[2]?.z ?? 0, -2);
    assert.equal(points[3]?.delay, 1.5);
  });

  it('order a cross by step outward, then by arm', () => {
    const points = crossPoints({ at: vec2(0, 0), length: 2, spacing: 1, stagger: 0.25 });

    assert.equal(points.length, 8);
    assert.deepEqual(
      points.map(({ delay }) => delay),
      [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25],
    );
    assert.deepEqual(points[0], { x: 0, z: 1, delay: 0 });
    close(points[1]?.x ?? 0, 1);
    close(points[6]?.z ?? 0, -2);
  });

  it('fan headings evenly around a direction', () => {
    assert.deepEqual(fan(1, 3, 0.5), [0.5, 1, 1.5]);
    assert.deepEqual(fan(1, 1, 0.5), [1]);
  });
});
