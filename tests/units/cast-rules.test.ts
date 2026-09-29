import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** A creature. */
const TEMPLATES = { grunt: {} } satisfies Record<string, UnitDef<UnitGame>>;

/** A game with one grunt casting the one-second channel. */
const casting = () => {
  const game = makeUnitGame(TEMPLATES);
  const grunt = game.units.spawn(game.id.grunt, { side: 1 });
  const { handle } = game.spells.cast(grunt, game.spellId.channel);

  return { ...game, grunt, handle };
};

describe('states interrupting casts (§I.7.1 F16)', () => {
  it('pause a creature’s cast while it is frozen, through the aura host’s tag edges', () => {
    const { auras, spells, clock, grunt, handle } = casting();

    clock.step();
    auras.apply(grunt, auraId('freeze'));
    assert.equal(spells.isInterrupted(grunt, 'freeze'), true);
    spells.step(grunt);
    spells.step(grunt);
    assert.equal(spells.get(handle)?.remaining, 1);
    auras.remove(grunt, auraId('freeze'));
    assert.equal(spells.isInterrupted(grunt, 'freeze'), false);
    spells.step(grunt);
    assert.equal(spells.get(handle)?.remaining, 0.75);
  });

  it('cancel it on a stun, as its timeline says, and refuse a new cast while stunned', () => {
    const { auras, spells, grunt, handle, spellId } = casting();

    auras.apply(grunt, auraId('stun'));
    assert.equal(spells.isRunning(handle), false);
    assert.equal(spells.get(handle), undefined);
    assert.equal(spells.cast(grunt, spellId.channel).refusal, 'gate');
  });

  it('raise an interrupt once for overlapping auras, ending it with the last', () => {
    const { auras, spells, units, grunt, handle } = casting();

    auras.apply(grunt, auraId('freeze'));
    auras.apply(grunt, auraId('root'));
    assert.equal(units.syncStates(grunt), 0);
    auras.apply(grunt, { aura: auraId('freeze'), duration: 5 });
    auras.remove(grunt, auraId('root'));
    assert.equal(spells.isInterrupted(grunt, 'freeze'), true);
    auras.remove(grunt, auraId('freeze'));
    assert.equal(spells.isInterrupted(grunt, 'freeze'), false);
    spells.step(grunt);
    assert.equal(spells.get(handle)?.remaining, 0.75);
  });

  it('refuse at load a state the table does not have', () => {
    assert.throws(
      () => makeUnitGame(TEMPLATES, { interrupts: { dazed: 'stun' } }),
      /the interrupting state dazed is not a unit state/,
    );
  });
});

describe('leaving standing (§I.7.1 F16)', () => {
  it('cancels every cast the unit runs: death, going down, leaving', () => {
    for (const leave of ['kill', 'down', 'despawn', 'disconnect'] as const) {
      const { units, spells, grunt, handle } = casting();

      assert.equal(units[leave](grunt), true);
      assert.equal(spells.isRunning(handle), false, leave);
      assert.equal(spells.isCasting(grunt), false, leave);
    }
  });
});
