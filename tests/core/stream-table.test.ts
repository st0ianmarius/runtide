import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStreamTable, roll, savableStream, stream } from '../../src/core/index.ts';

describe('the host stream table', () => {
  const table = () =>
    createStreamTable(12345, {
      crit: { kind: 'sequential', salt: 0 },
      pick: { kind: 'sequential', salt: 1 },
      trigger: { kind: 'sequential', salt: 0x7219e5 },
      placement: { kind: 'keyed', salt: 17 },
    });

  it('gives each sequential name its own salted stream, and refuses two that share a salt', () => {
    const streams = table();
    const [crit, pick] = [stream(12345, 0), stream(12345, 1)];

    assert.equal(streams.random('crit')(), crit());
    assert.equal(streams.random('pick')(), pick());
    assert.equal(streams.random('crit')(), crit());
    assert.throws(
      () => createStreamTable(1, { a: { kind: 'sequential', salt: 3 }, b: { kind: 'sequential', salt: 3 } }),
      /share the salt 3/,
    );
  });

  it('saves and restores its sequential streams, which then draw on as before', () => {
    const streams = table();

    streams.random('crit')();

    const saved = streams.save();
    const next = [streams.random('crit')(), streams.random('trigger')()];

    streams.restore(saved);
    assert.deepEqual([streams.random('crit')(), streams.random('trigger')()], next);
    assert.deepEqual(Object.keys(saved), ['crit', 'pick', 'trigger']);
    assert.throws(() => {
      savableStream(1).restore(0.5);
    }, /whole-number state/);
  });

  it('keeps a differently salted stream apart', () => {
    const streams = table();

    streams.random('crit')();

    assert.equal(streams.random('trigger')(), 0.75149060273543);
  });

  it('resolves a keyed name to keyed rolls over the key and a draw index', () => {
    const streams = table();
    const random = streams.random('placement', [60, 4]);

    assert.equal(random(), roll(12345, 17, 60, 4, 0));
    assert.equal(random(), roll(12345, 17, 60, 4, 1));
  });

  it('refuses a keyed name without a key', () => {
    assert.throws(() => table().random('placement'), RangeError);
  });
});
