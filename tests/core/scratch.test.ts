import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createScratch } from '../../src/core/index.ts';

describe('scratch lists', () => {
  it('give each nesting level its own list and reuse it', () => {
    const scratch = createScratch<number>();
    const outer = scratch.take();

    outer.push(1);

    const inner = scratch.take();

    inner.push(2);
    assert.notEqual(inner, outer);
    assert.equal(scratch.depth, 2);
    scratch.give();
    assert.deepEqual(outer, [1]);
    assert.deepEqual(inner, []);
    scratch.give();
    assert.equal(scratch.take(), outer);
    assert.deepEqual(outer, []);
  });

  it('refuse to give back a list that was not taken', () => {
    assert.throws(() => {
      createScratch().give();
    }, RangeError);
  });
});
