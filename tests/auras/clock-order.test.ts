import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wireTableOf } from '../../src/replication/index.ts';
import { aura, makeGame } from '../helpers/aura-game.ts';

/** One aura on each clock, both running out on their first step, each logging its expiry. */
const defs = {
  dash: aura({ duration: 0.125, clock: 'motion', onExpired: () => ['dash'] }),
  ward: aura({ duration: 0.125, onExpired: () => ['ward'] })
};

/** The same two clocks as the test game's, declared `motion` first. */
const MOTION_FIRST = { motion: { dt: 0.125 }, world: { dt: 0.125 } } as const;

describe('clock order', () => {
  it('ticks every clock of a bearer once, in declared order, with tickAll', () => {
    const worldFirst = makeGame(defs);
    const motionFirst = makeGame(defs, { clocks: MOTION_FIRST });

    for (const { auras, id, unit } of [worldFirst, motionFirst]) {
      const u = unit();

      auras.apply(u, id.dash);
      auras.apply(u, id.ward);
      auras.tickAll(u);
      assert.deepEqual(Array.from(u.auras.clocks), [1, 1]);
      assert.equal(auras.list(u).length, 0);
    }

    assert.deepEqual(worldFirst.log, ['ward@1', 'dash@1']);
    assert.deepEqual(motionFirst.log, ['dash@1', 'ward@1']);
  });

  it('pins the clock names by id in a wire table, so another declared order fails the handshake', () => {
    const worldFirst = makeGame(defs).auras;
    const motionFirst = makeGame(defs, { clocks: MOTION_FIRST }).auras;

    assert.deepEqual(worldFirst.clockTable.names, ['world', 'motion']);
    assert.deepEqual(motionFirst.clockTable.names, ['motion', 'world']);
    assert.deepEqual([worldFirst.clocks.world, motionFirst.clocks.world], [0, 1]);
    assert.equal(wireTableOf(worldFirst.clockTable).kind, 'auraClocks');
    assert.equal(wireTableOf(worldFirst.clockTable).checksum, wireTableOf(makeGame(defs).auras.clockTable).checksum);
    assert.notEqual(wireTableOf(worldFirst.clockTable).checksum, wireTableOf(motionFirst.clockTable).checksum);
  });
});
