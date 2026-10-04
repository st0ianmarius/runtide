import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digest, DIGEST_START, digestOf, digestText } from '../../src/core/index.ts';

describe('the state digest', () => {
  it('holds the frozen table of its own folds', () => {
    assert.deepEqual(
      [0, -0, 1, Number.NaN].map((value) => digest(DIGEST_START, value)),
      [0xaa_3e_5b_61, 0x96_b8_f7_08, 0x45_1a_74_72, 0x80_76_c2_14]
    );
    assert.equal(digestOf([1, 2.5, -3, 1e300]), 0x52_d2_4a_1d);
    assert.equal(digestOf([]), DIGEST_START);
  });

  it('folds an array, a typed array and a digest gone on from alike', () => {
    const values = [1, 2.5, -3, 1e300];

    assert.equal(digestOf(new Float64Array(values)), digestOf(values));
    assert.equal(digestOf(values.slice(1), digest(DIGEST_START, 1)), digestOf(values));
  });

  it('tells apart states an ulp, a sign or an order apart, and folds every NaN alike', () => {
    const base = digestOf([1, 1]);

    assert.notEqual(digestOf([1, 1 + Number.EPSILON]), base);
    assert.notEqual(digestOf([-1, -1]), base, 'two sign flips do not cancel');
    assert.notEqual(digestOf([1, 2]), digestOf([2, 1]));
    assert.equal(digest(DIGEST_START, Number.NaN), digest(DIGEST_START, 0 / 0));
  });

  it('folds a text by its length and code units, so its split shows', () => {
    assert.equal(digestText(DIGEST_START, 'ab'), digestOf([2, 97, 98]));
    assert.equal(digestText(DIGEST_START, ''), digest(DIGEST_START, 0));
    assert.notEqual(digestText(digestText(DIGEST_START, 'ab'), 'c'), digestText(digestText(DIGEST_START, 'a'), 'bc'));
  });
});
