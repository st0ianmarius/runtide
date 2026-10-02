import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  inPolygon,
  polygonArea,
  polygonCentroid,
  polygonEdgeDistanceSq,
  segmentDistanceSq,
  segmentIntersection,
  sweepCircle,
  vec2
} from '../../src/math/index.ts';

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

  it('never touches a circle of negative radius, which is empty, from its centre or across it', () => {
    const empty = { at: vec2(0, 0), r: -1 };

    assert.equal(sweepCircle(vec2(-5, 0), vec2(5, 0), empty), undefined);
    assert.equal(sweepCircle(vec2(0, 0), vec2(5, 0), empty), undefined);
    assert.equal(sweepCircle(vec2(-5, 0), vec2(5, 0), { at: vec2(0, 0), r: Number.NaN }), undefined);
  });
});

describe('polygons and segments', () => {
  const square = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];

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

  it('find where two segments cross, ends included, and no crossing for parallel or collinear ones', () => {
    assert.deepEqual(segmentIntersection(vec2(0, 0), vec2(2, 2), vec2(0, 2), vec2(2, 0)), { x: 1, z: 1 });
    assert.deepEqual(segmentIntersection(vec2(0, 0), vec2(1, 0), vec2(1, 0), vec2(1, 1)), { x: 1, z: 0 });
    assert.equal(segmentIntersection(vec2(0, 0), vec2(1, 0), vec2(2, -1), vec2(2, 1)), undefined);
    assert.equal(segmentIntersection(vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 1)), undefined);
    assert.equal(segmentIntersection(vec2(0, 0), vec2(1, 0), vec2(0.5, 0), vec2(3, 0)), undefined);
  });

  it('measure a polygon’s area in either winding, and its centroid, the corners’ mean when it has no area', () => {
    const triangle = [vec2(0, 0), vec2(4, 0), vec2(0, 3)];
    const ell = [vec2(0, 0), vec2(2, 0), vec2(2, 1), vec2(1, 1), vec2(1, 2), vec2(0, 2)];
    const centre = polygonCentroid(ell);

    assert.equal(polygonArea(square), 16);
    assert.equal(polygonArea([...square].reverse()), 16);
    assert.equal(polygonArea(triangle), 6);
    assert.equal(polygonArea(ell), 3);
    assert.equal(polygonArea([vec2(1, 1)]), 0);
    assert.deepEqual(polygonCentroid(square), { x: 2, z: 2 });
    assert.deepEqual(polygonCentroid([...square].reverse()), { x: 2, z: 2 });
    assert.deepEqual(polygonCentroid(triangle), { x: 4 / 3, z: 1 });
    assert.ok(Math.abs(centre.x - 2.5 / 3) < 1e-12 && Math.abs(centre.z - 2.5 / 3) < 1e-12);
    assert.deepEqual(polygonCentroid([vec2(0, 0), vec2(1, 1), vec2(2, 2)]), { x: 1, z: 1 });
    assert.deepEqual(polygonCentroid([]), { x: 0, z: 0 });
  });
});
