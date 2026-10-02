import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NO_CAST, type StatsContext } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell, type Unit } from '../helpers/spell-game.ts';

/** A spell over a one-second windup that marks its release. */
const slow = spell({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 1 } },
  release: () => [mark('slow')]
});

/** A spell over a half-second windup that marks its release. */
const quick = spell({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 0.5 } },
  release: () => [mark('quick')]
});

/** Steps the clock and a caster's casts `count` times. */
const advance = (
  game: { readonly step: () => void; readonly spells: { step: (unit: Unit) => void } },
  unit: Unit,
  count: number
) => {
  for (let i = 0; i < count; i++) {
    game.step();
    game.spells.step(unit);
  }
};

describe('isCasting', () => {
  it('answers for any cast, or for a cast of one spell, while it runs', () => {
    const game = makeSpellGame({ slow, quick });
    const hero = game.unit(1);

    assert.deepEqual([game.spells.isCasting(hero), game.spells.isCasting(hero, game.id.slow)], [false, false]);

    game.spells.cast(hero, game.id.quick);
    game.spells.cast(hero, game.id.slow);
    assert.deepEqual(
      [
        game.spells.isCasting(hero),
        game.spells.isCasting(hero, game.id.quick),
        game.spells.isCasting(hero, game.id.slow)
      ],
      [true, true, true]
    );

    advance(game, hero, 2);
    assert.deepEqual(
      [
        game.spells.isCasting(hero),
        game.spells.isCasting(hero, game.id.quick),
        game.spells.isCasting(hero, game.id.slow)
      ],
      [true, false, true]
    );

    advance(game, hero, 2);
    assert.deepEqual([game.spells.isCasting(hero), game.spells.isCasting(hero, game.id.slow)], [false, false]);
  });
});

describe('retaining a cast', () => {
  it('keeps an ended cast readable until as many unretains as retains, then gives its record back', () => {
    const game = makeSpellGame({ quick });
    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.quick).handle;

    assert.equal(game.spells.retain(handle), true);
    assert.equal(game.spells.retain(handle), true);
    advance(game, hero, 2);
    assert.deepEqual([game.spells.isRunning(handle), game.spells.get(handle)?.stage], [false, 'ended']);

    game.spells.unretain(handle);
    assert.equal(game.spells.pool.live, 1);
    game.spells.unretain(handle);
    assert.deepEqual([game.spells.get(handle), game.spells.pool.live], [undefined, 0]);
  });

  it('refuses to retain a stale handle, and lets an unretain of one do nothing', () => {
    const game = makeSpellGame({ quick });
    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.quick).handle;

    advance(game, hero, 2);

    const running = game.spells.cast(hero, game.id.quick).handle;

    assert.equal(game.spells.retain(handle), false);
    assert.equal(game.spells.retain(NO_CAST), false);
    game.spells.unretain(handle);
    game.spells.unretain(NO_CAST);
    assert.deepEqual([game.spells.isRunning(running), game.spells.pool.live], [true, 1]);
  });
});

describe('controls on a cast that is gone', () => {
  it('answers false to pause, resume, cancel, delay and finish for a stale handle, and changes nothing', () => {
    const game = makeSpellGame({ quick });
    const hero = game.unit(1);
    const stale = game.spells.cast(hero, game.id.quick).handle;

    advance(game, hero, 2);
    game.log.length = 0;

    const running = game.spells.cast(hero, game.id.quick).handle;

    assert.deepEqual(
      [
        game.spells.pause(stale),
        game.spells.resume(stale),
        game.spells.cancel(stale),
        game.spells.delay(stale, 1),
        game.spells.finish(stale, 'blocked')
      ],
      [false, false, false, false, false]
    );

    advance(game, hero, 2);
    assert.equal(game.spells.isRunning(running), false);
    assert.deepEqual(game.log, ['start quick@1', 'quick@1', 'release quick@1', 'end quick@1 released']);
  });

  it('answers false to pause and resume for an ended cast its retainer still holds', () => {
    const game = makeSpellGame({ quick });
    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.quick).handle;

    game.spells.retain(handle);
    advance(game, hero, 2);
    assert.deepEqual([game.spells.pause(handle), game.spells.resume(handle)], [false, false]);
    game.spells.unretain(handle);
  });
});

describe('a step whose own hook ends its cast', () => {
  it('runs no beat when breakIf cancels its own channel and answers false', () => {
    const game = makeSpellGame({
      drain: spell({
        activation: { kind: 'trigger' },
        timeline: {
          channel: {
            seconds: 2,
            every: 0.25,

            breakIf: (ctx) => {
              game.spells.cancel(ctx.cast);

              return false;
            },

            tick: () => [mark('beat')]
          }
        },
        release: () => undefined
      })
    });

    const hero = game.unit(1);

    game.spells.cast(hero, game.id.drain);
    game.log.length = 0;
    advance(game, hero, 1);
    assert.deepEqual(game.log, ['end drain@1 cancelled']);
    assert.equal(game.spells.pool.live, 0);
  });

  it("stops a step whose live stats read cancels the caster's casts, with no release", () => {
    let isStopping = false;

    const game = makeSpellGame({
      focus: spell({
        activation: { kind: 'trigger' },
        live: true,

        stats: (ctx: StatsContext<Game>) => {
          if (isStopping && ctx.caster !== undefined) {
            game.spells.cancelAll(ctx.caster);
          }

          return { power: 1 };
        },

        timeline: { windup: { seconds: 0.25 } },
        release: () => [mark('released')]
      })
    });

    const hero = game.unit(1);

    game.spells.cast(hero, game.id.focus);
    isStopping = true;
    advance(game, hero, 1);
    assert.deepEqual(game.log, ['start focus@1', 'end focus@1 cancelled']);
    assert.equal(game.spells.pool.live, 0);
  });
});
