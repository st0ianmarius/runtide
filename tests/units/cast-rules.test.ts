import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineAuraTags } from '../../src/auras/index.ts';
import { defineUnitStates, revive, type UnitDef } from '../../src/units/index.ts';
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

  it('refuse more interrupting states than a unit has bits for', () => {
    const tags = defineAuraTags(['stun']);

    const many = Object.fromEntries(
      Array.from({ length: 32 }, (_unused, i) => [`s${i}`, { tags: ['stun' as const], interrupt: 'stun' as const }]),
    );

    assert.throws(() => defineUnitStates(tags, many), /At most 31 unit states may raise interrupts/);
  });
});

describe('leaving life (§I.7.1 F16)', () => {
  it('cancels every cast the unit runs: death, despawning', () => {
    for (const leave of ['kill', 'despawn'] as const) {
      const { units, spells, grunt, handle } = casting();

      assert.equal(units[leave](grunt), true);
      assert.equal(spells.isRunning(handle), false, leave);
      assert.equal(spells.isCasting(grunt), false, leave);
    }
  });
});

describe('the revive proc (§II.6 P3, U3)', () => {
  it('stands a dead unit again, at a health or its maximum, and skips a living one', () => {
    const game = makeUnitGame(TEMPLATES);
    const [hero, ally] = [game.units.spawn(game.id.grunt, { side: 0 }), game.units.spawn(game.id.grunt, { side: 0 })];

    game.units.kill(ally);
    assert.equal(game.procs.apply(revive<UnitGame>({ health: 30 }), { self: hero, target: ally }).status, 'landed');
    assert.equal(ally.lifecycle, 'alive');
    assert.equal(ally.health, 30);
    game.units.kill(ally);
    assert.equal(game.procs.apply(revive<UnitGame>({ to: 'self' }), { self: ally }).status, 'landed');
    assert.equal(ally.health, 100);
    assert.equal(game.procs.apply(revive<UnitGame>(), { self: hero, target: ally }).status, 'skipped');
    assert.throws(
      () => game.procs.prepare([revive<UnitGame>({ health: 0 })], 'Test'),
      /health is a finite number above 0/,
    );
  });
});
