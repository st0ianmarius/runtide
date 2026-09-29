import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPool, NO_HANDLE } from '../../src/core/index.ts';

const castPool = () =>
  createPool({
    create: () => ({ spell: -1, elapsed: 0 }),
    reset: (cast) => Object.assign(cast, { spell: -1, elapsed: 0 }),
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
      [2, 0, 3, 4],
    );
  });
});
