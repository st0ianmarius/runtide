import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeSpellGame, spell, TICK_SLOTS } from '../helpers/spell-game.ts';

/** A windup that pauses on a stun its timeline names, and an auto swing. */
const SPELLS = {
  bolt: spell({
    activation: { kind: 'trigger' },
    timeline: { windup: { seconds: 1 }, interrupts: { stun: 'pause' } },
    release: () => undefined
  }),

  swing: spell({ activation: { kind: 'auto', interval: 1 }, release: () => undefined })
};

describe('the spell system’s wiring getters', () => {
  it('give back the host it was built with, and the interrupts it knows', () => {
    const game = makeSpellGame(SPELLS, { spells: { interrupts: ['death'] } });

    assert.equal(game.spells.host.log, game.log);
    assert.equal(game.spells.host.idOf?.(game.unit(3)), 3);
    assert.equal(game.spells.hasInterrupt('stun'), true);
    assert.equal(game.spells.hasInterrupt('death'), true);
    assert.equal(game.spells.hasInterrupt('freeze'), false);
    assert.equal(makeSpellGame(SPELLS).spells.hasInterrupt('death'), false);
  });

  it('count the tick slots delayed lists land in: the game’s, else one', () => {
    assert.equal(makeSpellGame(SPELLS).spells.delayedSlots, 1);
    assert.equal(makeSpellGame(SPELLS, { spells: { slots: TICK_SLOTS } }).spells.delayedSlots, TICK_SLOTS.size);
  });
});

describe('step counts for an end-of-tick audit', () => {
  it('count each caster’s steps and auto steps on the current tick, from 0 on each new tick', () => {
    const game = makeSpellGame(SPELLS);
    const hero = game.unit(1);
    const idle = game.unit(2);

    assert.equal(game.spells.stepCount(hero), 0);
    assert.equal(game.spells.autoStepCount(hero), 0);

    game.spells.cast(hero, game.id.bolt);
    game.spells.step(hero);
    game.spells.stepAuto(hero);
    assert.equal(game.spells.stepCount(hero), 1);
    assert.equal(game.spells.autoStepCount(hero), 1);

    // A caster with no cast and no clock due is counted all the same.
    game.spells.step(idle);
    game.spells.step(idle);
    assert.equal(game.spells.stepCount(idle), 2);
    assert.equal(game.spells.autoStepCount(idle), 0);

    game.step();
    assert.equal(game.spells.stepCount(hero), 0);
    assert.equal(game.spells.autoStepCount(hero), 0);
    assert.equal(game.spells.stepCount(idle), 0);

    game.spells.stepAuto(hero);
    game.spells.stepAuto(hero);
    assert.equal(game.spells.autoStepCount(hero), 2);
    assert.equal(game.spells.stepCount(hero), 0);
  });

  it('say whether each slot’s delayed lists were stepped on the current tick, the first slot by default', () => {
    const game = makeSpellGame(SPELLS, { spells: { slots: TICK_SLOTS } });

    assert.equal(game.spells.delayedStepped(), false);
    game.spells.stepDelayed();
    assert.equal(game.spells.delayedStepped(), true);
    assert.equal(game.spells.delayedStepped(TICK_SLOTS.id.world), true);
    assert.equal(game.spells.delayedStepped(TICK_SLOTS.id.late), false);

    game.step();
    assert.equal(game.spells.delayedStepped(), false);
    game.spells.stepDelayed(TICK_SLOTS.id.late);
    assert.equal(game.spells.delayedStepped(TICK_SLOTS.id.late), true);
    assert.equal(game.spells.delayedStepped(TICK_SLOTS.id.world), false);
  });

  it('answer false for a slot outside the game’s, which stepDelayed refuses', () => {
    const game = makeSpellGame(SPELLS);
    const outside = TICK_SLOTS.id.late;

    assert.throws(() => game.spells.stepDelayed(outside));
    assert.equal(game.spells.delayedStepped(outside), false);
  });
});
