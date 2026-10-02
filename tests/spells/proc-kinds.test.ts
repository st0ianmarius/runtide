import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toId } from '../../src/core/ids.ts';
import { explainProc, PROC_SKIPPED, run } from '../../src/procs/index.ts';
import { after, castSpell, rescaleClocks } from '../../src/spells/index.ts';
import { type Game, makeSpellGame, mark, spell, SPELL_TAGS } from '../helpers/spell-game.ts';

/** A game with a bolt that marks its release, and two auto clocks: a melee swing and a fire volley. */
const procGame = () =>
  makeSpellGame({
    bolt: spell({ activation: { kind: 'trigger' }, release: (ctx) => [mark(`bolt r${ctx.rank}`)] }),
    swing: spell({ tags: ['melee'], activation: { kind: 'auto', interval: 2 }, release: () => undefined }),
    volley: spell({ tags: ['fire'], activation: { kind: 'auto', interval: 4 }, release: () => undefined })
  });

describe('the castSpell proc kind', () => {
  it('prepares a name into its id, and passes a live id as it is', () => {
    const game = procGame();
    const [byName, byId] = game.procs.prepare([castSpell<Game>('bolt'), castSpell<Game>(game.id.volley)], 'Test');

    assert.ok(byName?.kind === 'castSpell' && byId?.kind === 'castSpell');
    assert.deepEqual([byName.spell, byId.spell], [game.id.bolt, game.id.volley]);
  });

  it('refuses at load an id that is not a live spell, and an unknown name at load and as it applies', () => {
    const game = procGame();

    for (const index of [1.5, -1, game.registry.size]) {
      assert.throws(
        () => game.procs.prepare([castSpell<Game>(toId<'spells'>(index))], 'Test'),
        /is not a live spell id/
      );
    }

    assert.throws(() => game.procs.prepare([castSpell<Game>('nope')], 'Test'), /unknown spell nope/);
    assert.throws(() => game.procs.run([castSpell<Game>('nope')], { self: game.unit(1) }), /unknown spell nope/);
  });

  it('explains its spell by id from a name, with its rank, cooldown bypass and every stage it overrides', () => {
    const game = procGame();

    const explained = explainProc(
      game.procs,
      castSpell<Game>('bolt', {
        rank: 3,
        ignoreCooldown: true,
        stages: { windup: 0.5, channel: 2, recover: 0.25 }
      })
    );

    assert.deepEqual(explained.values, {
      spell: game.id.bolt,
      rank: 3,
      ignoreCooldown: 1,
      windup: 0.5,
      channel: 2,
      recover: 0.25
    });
    assert.deepEqual(explainProc(game.procs, castSpell<Game>(game.id.bolt)).values, { spell: game.id.bolt });
  });

  it('skips, casting nothing, when its kind is applied with no unit to cast', () => {
    const game = procGame();
    const outcomes: unknown[] = [];

    game.procs.run(
      [
        run<Game>('probe', (ctx) => {
          const { castSpell: cast, rescaleClocks: rescale } = game.spells.procKinds;

          outcomes.push(
            cast.apply(castSpell<Game>('bolt'), ctx, undefined) ?? 'none',
            rescale.apply(rescaleClocks<Game>(0.5), ctx, undefined) ?? 'none'
          );
        })
      ],
      { self: game.unit(1) }
    );

    assert.deepEqual(outcomes, [PROC_SKIPPED, PROC_SKIPPED]);
    assert.deepEqual(game.log, []);
  });
});

describe('the after proc kind', () => {
  it('explains its seconds and the procs it holds', () => {
    const game = procGame();
    const explained = explainProc(game.procs, after<Game>(0.75, [castSpell<Game>('bolt', { rank: 2 })]));

    assert.deepEqual(explained.values, { seconds: 0.75 });
    assert.deepEqual(
      explained.procs.map((nested) => nested.values),
      [{ spell: game.id.bolt, rank: 2 }]
    );
  });

  it('refuses a bound that is not a function, at load, with the type error as the cause', () => {
    const game = procGame();
    const proc = after<Game>(1, [mark('late')]);

    Reflect.set(proc, 'bound', 5);
    assert.throws(
      () => game.procs.prepare([proc], 'Test'),
      (error) =>
        error instanceof RangeError &&
        error.message.includes("Test: an after proc's bound is a function of its owner") &&
        error.cause instanceof TypeError
    );
  });
});

describe('the rescaleClocks proc kind', () => {
  it('rescales every clock still counting with no tag, and skips a unit with none counting', () => {
    const game = procGame();
    const [hero, idle] = [game.unit(1), game.unit(2)];

    game.spells.stepAuto(hero);
    game.spells.disarm(idle, game.id.swing);
    game.spells.disarm(idle, game.id.volley);

    assert.equal(game.procs.apply(rescaleClocks<Game>(0.5), { self: hero }).status, 'landed');
    assert.deepEqual([game.spells.autoClock(hero, game.id.swing), game.spells.autoClock(hero, game.id.volley)], [1, 2]);
    assert.equal(game.procs.apply(rescaleClocks<Game>(0.5), { self: idle }).status, 'skipped');
  });

  it('rescales the clocks of a tag given by id', () => {
    const game = procGame();
    const hero = game.unit(1);

    game.spells.stepAuto(hero);
    assert.equal(
      game.procs.apply(rescaleClocks<Game>(0.5, { tag: SPELL_TAGS.id.melee }), { self: hero }).status,
      'landed'
    );
    assert.deepEqual([game.spells.autoClock(hero, game.id.swing), game.spells.autoClock(hero, game.id.volley)], [1, 4]);
  });

  it('prepares a tag name into its id, leaves a proc with no tag as it is, and refuses a factor that is not finite from 0', () => {
    const game = procGame();
    const untagged = rescaleClocks<Game>(2);
    const [tagged, plain] = game.procs.prepare([rescaleClocks<Game>(2, { tag: 'fire' }), untagged], 'Test');

    assert.ok(tagged?.kind === 'rescaleClocks');
    assert.equal(tagged.tag, SPELL_TAGS.id.fire);
    assert.equal(plain, untagged);

    for (const factor of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => game.procs.prepare([rescaleClocks<Game>(factor)], 'Test'), /finite factor from 0/);
    }
  });

  it('explains its factor, and its tag by id when it names one', () => {
    const game = procGame();

    assert.deepEqual(explainProc(game.procs, rescaleClocks<Game>(0.5)).values, { factor: 0.5 });
    assert.deepEqual(explainProc(game.procs, rescaleClocks<Game>(0.5, { tag: 'melee' })).values, {
      factor: 0.5,
      tag: SPELL_TAGS.id.melee
    });
  });
});
