import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Bitset, createBitset } from '../../src/core/index.ts';

describe('bitsets', () => {
  it('add, test and remove small integers', () => {
    const tags = createBitset([1, 40]);

    tags.add(3);
    tags.remove(40);

    assert.equal(tags.has(1), true);
    assert.equal(tags.has(3), true);
    assert.equal(tags.has(40), false);
    assert.equal(tags.size(), 2);
    assert.deepEqual(tags.toArray(), [1, 3]);

    for (const index of [-1, 1.5, Number.NaN]) {
      assert.throws(() => {
        tags.add(index);
      }, /whole indices from 0/);
    }
  });

  it('refuse a fraction or a negative index to has, remove and create, as add does', () => {
    const tags = createBitset([1]);

    for (const index of [-1, 1.5, Number.NaN]) {
      assert.throws(() => tags.has(index), /whole indices from 0/);
      assert.throws(() => {
        tags.remove(index);
      }, /whole indices from 0/);
      assert.throws(() => createBitset([index]), /whole indices from 0/);
    }

    assert.deepEqual(tags.toArray(), [1], '1.5 neither tested nor removed 1');
  });

  it('combine in place: union, difference, intersection', () => {
    const a = createBitset([1, 2, 3]);

    a.union(createBitset([70]));
    assert.deepEqual(a.toArray(), [1, 2, 3, 70]);
    a.difference(createBitset([2]));
    assert.deepEqual(a.toArray(), [1, 3, 70]);
    a.intersection(createBitset([3, 70, 90]));
    assert.deepEqual(a.toArray(), [3, 70]);
  });

  it('answer immunity-style questions: intersects and equals', () => {
    const blockedBy = createBitset([5, 9]);

    assert.equal(blockedBy.intersects(createBitset([9])), true);
    assert.equal(blockedBy.intersects(createBitset([6])), false);
    assert.equal(blockedBy.equals(createBitset([9, 5])), true);
  });

  it('clone into an independent set and clear', () => {
    const a = createBitset([4]);
    const b = a.clone();

    a.clear();

    assert.equal(a.isEmpty(), true);
    assert.deepEqual(b.toArray(), [4]);
  });

  it('refuse to combine with a set they did not make', () => {
    const foreign: Bitset = { ...createBitset() };

    assert.throws(() => {
      createBitset().union(foreign);
    }, TypeError);
  });
});
