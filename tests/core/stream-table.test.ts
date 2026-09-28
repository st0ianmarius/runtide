import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStreamTable, roll, stream } from '../../src/core/index.ts';

describe('the host stream table', () => {
  const table = () =>
    createStreamTable(12345, {
      crit: { kind: 'sequential', salt: 0 },
      pick: { kind: 'sequential', salt: 0 },
      trigger: { kind: 'sequential', salt: 0x7219e5 },
      placement: { kind: 'keyed', salt: 17 },
    });

  it('maps names with the same salt onto one sequential stream, so every draw keeps its place', () => {
    const streams = table();
    const main = stream(12345);

    assert.equal(streams.random('crit')(), main());
    assert.equal(streams.random('pick')(), main());
    assert.equal(streams.random('crit')(), main());
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
