import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPool, NO_HANDLE, POOL_MIN_FREE } from '../../src/core/index.ts';

/** A pool of casts; `minFree` 0 by default here, so a released slot is reused at once. */
const castPool = (minFree = 0) =>
  createPool({
    create: () => ({ spell: -1, elapsed: 0 }),
    reset: (cast) => Object.assign(cast, { spell: -1, elapsed: 0 }),
    minFree
  });

describe('pools with generational handles', () => {
  it('hand out items behind handles', () => {
    const pool = castPool();
    const handle = pool.acquire();
    const cast = pool.get(handle);

    assert.deepEqual(cast, { spell: -1, elapsed: 0 });
    assert.equal(pool.live, 1);
    assert.equal(pool.isLive(handle), true);
  });

  it('detect a stale handle after release, even once the slot is reused', () => {
    const pool = castPool();
    const first = pool.acquire();

    assert.equal(pool.release(first), true);

    const second = pool.acquire();

    assert.equal(pool.slotOf(second), pool.slotOf(first));
    assert.notEqual(second, first);
    assert.equal(pool.get(first), undefined);
    assert.equal(pool.isLive(first), false);
    assert.equal(pool.release(first), false);
    assert.equal(pool.isLive(second), true);
  });

  it('reset an item on release, so the next acquire gets it clean', () => {
    const pool = castPool();
    const handle = pool.acquire();

    Object.assign(pool.get(handle) ?? {}, { spell: 4, elapsed: 1.5 });
    pool.release(handle);

    assert.deepEqual(pool.get(pool.acquire()), { spell: -1, elapsed: 0 });
  });

  it('allocate nothing in a steady state, counted through created', () => {
    const pool = castPool();
    const handles = Array.from({ length: 50 }, () => pool.acquire());

    for (let tick = 0; tick < 100; tick++) {
      const index = tick % handles.length;

      pool.release(handles[index] ?? pool.acquire());
      handles[index] = pool.acquire();
    }

    assert.equal(pool.created, 50);
    assert.equal(pool.live, 50);
  });

  it('never hands out the empty handle', () => {
    const pool = castPool();

    assert.equal(pool.isLive(pool.acquire()), true);
    assert.equal(pool.get(pool.acquire()) === undefined, false);
    assert.equal(NO_HANDLE, 0);
  });

  it('keeps handles small integers through generations, wrapping past 2,047 reuses and never to the empty handle', () => {
    const pool = castPool();
    const first = pool.acquire();
    let handle = first;

    for (let i = 0; i < 2046; i++) {
      pool.release(handle);
      handle = pool.acquire();
      assert.ok(handle > 0 && handle < 2 ** 31 && Number.isInteger(handle));
      assert.equal(pool.isLive(first), false);
    }

    pool.release(handle);
    handle = pool.acquire();
    assert.equal(handle, first, 'the 2,048th occupant of a slot has the first one’s handle again');
    assert.equal(pool.slotOf(handle), 0);
  });

  it('reuses released slots oldest first', () => {
    const pool = castPool();
    const handles = Array.from({ length: 4 }, () => pool.acquire());

    for (const handle of [handles[2], handles[0], handles[3]]) {
      assert.equal(handle !== undefined && pool.release(handle), true);
    }

    assert.deepEqual(
      [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()].map((h) => pool.slotOf(h)),
      [2, 0, 3, 4]
    );
  });

  it('keeps minFree released slots waiting, making new items until more than that many are free', () => {
    const pool = castPool(2);
    const handles = Array.from({ length: 3 }, () => pool.acquire());

    for (const handle of handles) {
      pool.release(handle);
    }

    assert.deepEqual(
      [pool.acquire(), pool.acquire(), pool.acquire()].map((h) => pool.slotOf(h)),
      [0, 3, 4],
      'three free slots: the oldest is reused, then two wait and new ones are made'
    );
    assert.equal(pool.created, 5);
  });

  it('reuses one slot no more than once per minFree other acquisitions, so a stale handle cannot wrap back soon', () => {
    const pool = createPool({ create: () => ({ spell: -1 }) });
    const stale = pool.acquire();

    pool.release(stale);

    // A nearly full pool cycling one item: with minFree 0, the 2,047th of these would get the stale handle again.
    for (let i = 0; i < 2 * 2047; i++) {
      const handle = pool.acquire();

      assert.notEqual(handle, stale);
      assert.equal(pool.isLive(stale), false);
      pool.release(handle);
    }

    assert.equal(pool.created, POOL_MIN_FREE + 1);
  });

  it('swaps an item behind a live handle, handing back the one it replaces, and refuses a stale handle', () => {
    const pool = castPool();
    const handle = pool.acquire();
    const held = pool.get(handle);
    const filled = { spell: 7, elapsed: 0.5 };

    assert.equal(pool.swap(handle, filled), held);
    assert.equal(pool.get(handle), filled);
    pool.release(handle);
    assert.throws(() => pool.swap(handle, { spell: 1, elapsed: 0 }), /live handle/);
  });

  it('refuses a minFree that is not a whole number from 0', () => {
    assert.throws(() => castPool(-1), /minFree/);
    assert.throws(() => castPool(1.5), /minFree/);
  });
});
