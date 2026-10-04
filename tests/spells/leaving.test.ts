import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { run } from '../../src/procs/index.ts';
import { after } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell } from '../helpers/spell-game.ts';

/** A one-second windup whose end throws `message`, stopped by a stun. */
const brittle = (message: string) =>
  spell({
    activation: { kind: 'trigger' },
    timeline: { windup: { seconds: 1 }, interrupts: { stun: 'cancel' } },
    release: () => undefined,

    onEnd: () => {
      throw new Error(message);
    }
  });

/** A one-second windup that marks its end, stopped by a stun. */
const sturdy = spell({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 1 }, interrupts: { stun: 'cancel' } },
  release: () => undefined,
  onEnd: () => [mark('sturdy ended')]
});

/** A game whose caster runs a brittle cast, then a sturdy one. */
const castingGame = () => {
  const game = makeSpellGame(
    { first: brittle('first end'), second: brittle('second end'), sturdy },
    { spells: { interrupts: ['stun'] } }
  );

  const hero = game.unit(1);

  return { game, hero };
};

describe('ending a caster’s casts in bulk', () => {
  it('cancels every cast when one’s end throws, then throws the first error', () => {
    const { game, hero } = castingGame();

    game.spells.cast(hero, game.id.first);
    game.spells.cast(hero, game.id.sturdy);
    assert.throws(() => game.spells.cancelAll(hero), /first end/);
    assert.deepEqual([game.spells.isCasting(hero), game.log.includes('sturdy ended@1')], [false, true]);
  });

  it('cancels every cast an interrupt cancels when one’s end throws, the first error surfacing', () => {
    const { game, hero } = castingGame();

    game.spells.cast(hero, game.id.first);
    game.spells.cast(hero, game.id.sturdy);
    assert.throws(() => game.spells.interrupt(hero, 'stun'), /first end/);
    assert.deepEqual([game.spells.isCasting(hero), game.log.includes('sturdy ended@1')], [false, true]);
    assert.equal(game.spells.isInterrupted(hero, 'stun'), true);
  });

  it('suppresses the later errors into the first', () => {
    const { game, hero } = castingGame();

    game.spells.cast(hero, game.id.first);
    game.spells.cast(hero, game.id.second);
    assert.throws(
      () => game.spells.cancelAll(hero),
      (error) =>
        error instanceof SuppressedError &&
        error.error instanceof Error &&
        error.error.message === 'first end' &&
        error.suppressed instanceof Error &&
        error.suppressed.message === 'second end'
    );
    assert.equal(game.spells.isCasting(hero), false);
  });
});

describe('a delayed list for an owner gone', () => {
  /** A game whose host answers gone units from a set, with a spell that kills its caster mid-list then delays. */
  const goneGame = () => {
    const gone = new Set<number>();

    const game = makeSpellGame(
      {
        doom: spell({
          activation: { kind: 'trigger' },

          release: (ctx) => [
            run<Game>('die', () => {
              gone.add(ctx.caster.id);
              game.spells.withdrawDelayed(ctx.caster);
            }),
            after<Game>(0.25, [mark('owned')]),
            after<Game>(0.25, [mark('unowned')], { owner: 'none' })
          ]
        })
      },
      { host: { isGone: (unit) => gone.has(unit.id) } }
    );

    return { game, gone };
  };

  it('is refused when its owner left life before it was scheduled; an unowned list still lands', () => {
    const { game } = goneGame();
    const hero = game.unit(1);

    game.spells.cast(hero, game.id.doom);
    game.step();
    assert.equal(game.spells.stepDelayed(), 1);
    assert.deepEqual(
      game.log.filter((line) => line === 'owned@1' || line === 'unowned@1'),
      ['unowned@1']
    );
  });

  it('is scheduled for an owner still there', () => {
    const { game } = goneGame();
    const hero = game.unit(1);

    assert.equal(game.procs.apply(after<Game>(0.25, [mark('owned')]), { self: hero }).status, 'landed');
    game.step();
    assert.equal(game.spells.stepDelayed(), 1);
  });
});
