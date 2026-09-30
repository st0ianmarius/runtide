import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { KeySorter } from '../../src/world/index-sorter.ts';

/** Sorts entries 0..n by `keys` with a sorter, as a selector does. */
const sorted = (sorter: KeySorter, keys: readonly number[]): number[] => {
  const entries = keys.map((_key, i) => i);

  sorter.sort(entries, keys, entries.length);

  return entries;
};

/** The same order by a plain comparison: by key, then by entry. */
const expected = (keys: readonly number[]): number[] =>
  keys.map((_key, i) => i).sort((a, b) => (keys[a] ?? 0) - (keys[b] ?? 0) || a - b);

describe('the key sorter', () => {
  it('orders entries by key, then by entry, short or long, with keys up to 2^32 − 1', () => {
    const sorter = new KeySorter();

    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 2 ** 32 - 1 }), { maxLength: 300 }), (keys) => {
        assert.deepEqual(sorted(sorter, keys), expected(keys));
      }),
    );
  });

  it('orders small ids, which share their high bytes, and repeated keys by entry', () => {
    const sorter = new KeySorter();
    const keys = Array.from({ length: 200 }, (_unused, i) => (i * 37) % 50);

    assert.deepEqual(sorted(sorter, keys), expected(keys));
    assert.deepEqual(sorted(sorter, keys.slice(0, 20)), expected(keys.slice(0, 20)));
  });
});
