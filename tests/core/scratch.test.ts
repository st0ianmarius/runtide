import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createScratch } from '../../src/core/index.ts';

describe('scratch arrays', () => {
  it('give each nesting level its own array and reuse it', () => {
    const scratch = createScratch<number>();
    const outer = scratch.take();

    outer[0] = 1;

    const inner = scratch.take();

    inner[0] = 2;
    assert.notEqual(inner, outer);
    assert.equal(scratch.depth, 2);
    scratch.give(1);
    assert.deepEqual(outer, [1]);
    assert.deepEqual(inner, [undefined]);
    scratch.give();
    assert.equal(scratch.take(), outer);
    assert.deepEqual(outer, [1]);
  });

  it('keep their storage: a given-back array keeps its length', () => {
    const scratch = createScratch<string>();
    const list = scratch.take();

    list[0] = 'a';
    list[1] = 'b';
    scratch.give(2);
    assert.equal(scratch.take().length, 2);
  });

  it('come back to depth 0 when a throwing user gives back in a finally', () => {
    const scratch = createScratch<number>();

    assert.throws(() => {
      scratch.take();

      try {
        throw new Error('hook failed');
      } finally {
        scratch.give();
      }
    }, /hook failed/);
    assert.equal(scratch.depth, 0);
  });

  it('refuse to give back an array that was not taken', () => {
    assert.throws(() => {
      createScratch().give();
    }, RangeError);
  });
});
