import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEntityIds } from '../../src/core/index.ts';

describe('entity ids', () => {
  it('count from 1, going on from the ids handed out', () => {
    const ids = createEntityIds(41);

    assert.deepEqual([ids.next(), ids.next(), ids.count()], [42, 43, 43]);
  });

  it('refuse to go on from a count outside the id space, rather than throw on the first id', () => {
    for (const from of [-1, 1.5, Number.NaN, 2 ** 32, 2 ** 40]) {
      assert.throws(() => createEntityIds(from), /whole number of ids handed out, up to 4294967295/);
    }

    const spent = createEntityIds(2 ** 32 - 1);

    assert.equal(spent.count(), 2 ** 32 - 1);
    assert.throws(() => spent.next(), /space is spent/);
  });
});
