import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inPolygon, polygonEdgeDistanceSq, segmentDistanceSq, sweepCircle, vec2 } from '../../src/math/index.ts';

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
});
