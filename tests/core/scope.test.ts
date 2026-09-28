import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createScope } from '../../src/core/index.ts';

const scope = () => createScope({ owner: 1, source: 0 });

describe('scope', () => {
  it('runs a function as an owner and restores the one before', () => {
    const s = scope();

    assert.equal(
      s.withOwner(2, () => s.owner),
      2,
    );
    assert.equal(s.owner, 1);
  });

  it('credits hits to a damage source for the call only', () => {
    const s = scope();

    s.withSource(9, () => {
      assert.equal(s.source, 9);
    });
    assert.equal(s.source, 0);
  });

  it('emits as nobody inside a world scope, until an owner is entered', () => {
    const s = scope();

    s.asWorld(() => {
      assert.equal(s.eventOwner, undefined);
      s.withOwner(3, () => {
        assert.equal(s.eventOwner, 3);
      });
      assert.equal(s.isWorld, true);
    });
    assert.equal(s.eventOwner, 1);
  });

  it('is idempotent: re-entering the scope in force changes nothing', () => {
    const s = scope();

    s.withOwner(1, () => {
      s.withSource(0, () => {
        assert.deepEqual(s.capture(), { owner: 1, source: 0, isWorld: false });
      });
    });
    s.asWorld(() => {
      s.asWorld(() => {
        assert.equal(s.isWorld, true);
      });
    });
    assert.equal(s.isWorld, false);
  });

  it('is re-entrant and restores the scope when the function throws', () => {
    const s = scope();

    assert.throws(() =>
      s.withOwner(5, () =>
        s.withSource(6, () => {
          throw new Error('boom');
        }),
      ),
    );
    assert.deepEqual(s.capture(), { owner: 1, source: 0, isWorld: false });
  });

  it('restores a captured frame, as a delayed proc landing does', () => {
    const s = scope();
    const frame = s.withOwner(4, () => s.withSource(8, () => s.capture()));

    s.asWorld(() => {
      s.within(frame, () => {
        assert.deepEqual([s.owner, s.source, s.isWorld], [4, 8, false]);
      });
    });
    assert.deepEqual(s.capture(), { owner: 1, source: 0, isWorld: false });
  });
});
