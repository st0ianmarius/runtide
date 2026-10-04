import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timeLeft } from '../../src/procs/index.ts';
import { aura, type Game, makeSpellGame, spell, type Unit } from '../helpers/spell-game.ts';

/** The director a holder answers, set once the game makes it; the caster until then. */
interface DirectorRef {
  director?: Unit;
}

/**
 * A game whose `smash` lands a gap on a shared director (gone on its death), `roar` a spacing there that outlives
 * it, and `jab` a cooldown on its caster alone.
 */
const hordeGame = () => {
  const ref: DirectorRef = {};
  const holder = (caster: Unit): Unit => ref.director ?? caster;

  const game = makeSpellGame(
    {
      smash: spell({
        activation: { kind: 'trigger' },
        cooldown: { aura: 'gap', seconds: 1, holder },
        release: () => undefined
      }),
      roar: spell({
        activation: { kind: 'trigger' },
        cooldown: [
          { aura: 'spacing', seconds: 2, holder },
          { aura: 'jabCooldown', seconds: 1 }
        ],
        release: () => undefined
      }),
      jab: spell({
        activation: { kind: 'trigger' },
        cooldown: { aura: 'jabCooldown', seconds: 1 },
        release: () => undefined
      })
    },
    {
      auras: {
        gap: aura({ duration: 9, tags: ['busy'], removedOn: ['dead'] }),
        spacing: aura({ duration: 9 }),
        jabCooldown: aura({ duration: 9 })
      }
    }
  );

  const director = game.unit(500);

  ref.director = director;

  return { game, director, first: game.unit(1), second: game.unit(2) };
};

describe('a cooldown kept on a holder', () => {
  it('lands on the holder and refuses every caster answering it while it runs, not the caster’s own', () => {
    const { game, director, first, second } = hordeGame();

    assert.equal(game.spells.cast(first, game.id.smash).status, 'ended');
    assert.deepEqual(
      [game.auras.has(first, game.auraId.gap), game.auras.has(director, game.auraId.gap)],
      [false, true]
    );
    assert.deepEqual(
      [game.spells.check(second, game.id.smash), game.spells.isCooling(first, game.id.smash)],
      ['cooldown', true]
    );
    assert.equal(game.spells.cooldownLeft(second, game.id.smash), 1);
    assert.equal(game.spells.cast(second, game.id.smash).status, 'refused');

    game.spells.cast(second, game.id.roar);
    assert.deepEqual(
      [game.spells.check(first, game.id.roar), game.spells.check(first, game.id.jab)],
      ['cooldown', undefined],
      'the held spacing refuses the other caster; the caster’s own cooldown only its caster'
    );
    assert.equal(game.spells.cooldownLeft(second, game.id.roar), 2);

    for (let i = 0; i < 4; i++) {
      game.step();
      game.auras.tick(director, 'world');
    }

    assert.deepEqual(
      [game.spells.check(second, game.id.smash), game.spells.cooldownLeft(first, game.id.roar)],
      [undefined, 1]
    );
  });

  it('runs on the holder’s clock: scaling its time left there scales every caster’s', () => {
    const { game, director, first, second } = hordeGame();

    game.spells.cast(first, game.id.smash);
    assert.equal(game.auras.scaleTimeLeft(director, game.auras.tags.id.busy, 0.5), 1);
    assert.equal(game.spells.cooldownLeft(second, game.id.smash), 0.5);
    assert.equal(
      game.procs.apply(timeLeft<Game>('busy', { max: 0.25, to: 'self' }), { self: director }).status,
      'landed'
    );
    assert.equal(game.spells.cooldownLeft(first, game.id.smash), 0.25);
    assert.equal(
      game.procs.apply(timeLeft<Game>('busy', { max: 0.25, to: 'self' }), { self: second }).status,
      'skipped'
    );
  });

  it('is whatever the aura system holds on a gone holder: a death frees only auras removed on it, a despawn all', () => {
    const { game, director, first, second } = hordeGame();

    game.spells.cast(first, game.id.smash);
    game.spells.cast(first, game.id.roar);
    game.auras.enterState(director, 'dead');
    assert.deepEqual(
      [game.spells.check(second, game.id.smash), game.spells.check(second, game.id.roar)],
      [undefined, 'cooldown'],
      'the gap goes with its holder’s death; the spacing does not'
    );

    game.spells.cast(second, game.id.smash);
    assert.deepEqual(
      [game.auras.has(director, game.auraId.gap), game.spells.check(first, game.id.smash)],
      [true, 'cooldown'],
      'a cast after a death lands on the unit the holder still answers'
    );

    game.auras.release(director);
    assert.deepEqual(
      [game.spells.check(second, game.id.roar), game.spells.check(first, game.id.smash)],
      [undefined, undefined]
    );

    game.spells.cast(second, game.id.smash);
    assert.deepEqual(
      [game.auras.has(director, game.auraId.gap), game.spells.check(first, game.id.smash)],
      [false, undefined],
      'a cast after a despawn lands nothing on the released holder, so the casters stay free'
    );
  });

  it('is refused at define time unless it is a function', () => {
    const cooldown = { aura: 'gap' };

    Reflect.set(cooldown, 'holder', 5);
    assert.throws(
      () =>
        makeSpellGame(
          { bad: spell({ activation: { kind: 'trigger' }, cooldown, release: () => undefined }) },
          { auras: { gap: aura({ duration: 1 }) } }
        ),
      /holder is a function of the caster/
    );
  });
});
