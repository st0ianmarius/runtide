import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { add, finishScaled, scaled, type StatView } from '../../src/modifiers/index.ts';
import { makeSpellGame, mark, spell, STATS } from '../helpers/spell-game.ts';

/** A target's stats: the table's bases, with its maximum health set. */
const targetWith = (maxHealth: number): StatView => ({
  total: (stat) => (stat === STATS.id.maxHealth ? maxHealth : (STATS.columns.base[stat] ?? 0)),
  base: (stat) => STATS.columns.base[stat] ?? 0
});

/** A `live` spell with a stats table: a caster-only value and one with a target term, over a one-second windup. */
const surge = spell({
  activation: { kind: 'trigger' },
  live: true,
  stats: {
    power: scaled(0, add('power', 1)),
    hurt: scaled(0, add('power', 1), add('maxHealth', 0.1, { from: 'target' }))
  },
  timeline: { windup: { seconds: 1 } },
  release: () => undefined
});

describe('copied stats', () => {
  it("copies a live cast's stats table into a box that the cast's later refreshes leave alone", () => {
    const game = makeSpellGame({ surge });
    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.surge).handle;
    const copy = game.spells.copyStats(handle);

    assert.ok(copy !== undefined);
    hero.stats[STATS.id.power] = 30;
    game.step();
    game.spells.step(hero);

    assert.deepEqual(game.spells.get(handle)?.stats, { power: 30, hurt: 30 });
    assert.deepEqual(copy.stats, { power: 10, hurt: 10 });
    assert.equal(copy.scaled['power'], 10);

    const now = game.spells.copyStats(handle);
    const hurt = copy.scaled['hurt'];
    const hurtNow = now?.scaled['hurt'];

    assert.ok(typeof hurt === 'object' && typeof hurtNow === 'object');
    assert.notEqual(hurt, hurtNow);
    assert.equal(finishScaled(hurt, targetWith(300)), 10 + 30);
    assert.equal(finishScaled(hurtNow, targetWith(300)), 30 + 30);
  });

  it('gives no copy for a snapshot cast, a live cast with a stats function or none, or a stale handle', () => {
    const game = makeSpellGame({
      snapshot: spell({
        activation: { kind: 'trigger' },
        stats: { power: scaled(0, add('power', 1)) },
        timeline: { windup: { seconds: 1 } },
        release: () => undefined
      }),
      called: spell({
        activation: { kind: 'trigger' },
        live: true,
        stats: () => ({ power: 1 }),
        timeline: { windup: { seconds: 1 } },
        release: () => undefined
      }),
      bare: spell({
        activation: { kind: 'trigger' },
        live: true,
        timeline: { windup: { seconds: 1 } },
        release: () => undefined
      }),
      bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined })
    });

    const hero = game.unit(1);

    for (const id of [game.id.snapshot, game.id.called, game.id.bare, game.id.bolt]) {
      const handle = game.spells.cast(hero, id).handle;

      assert.equal(game.spells.copyStats(handle), undefined, game.registry.name(id));
    }
  });

  it('takes a copy given back with giveStats into the pool the next cast of that spell takes its box from', () => {
    const game = makeSpellGame({ surge });
    const hero = game.unit(1);
    const first = game.spells.copyStats(game.spells.cast(hero, game.id.surge).handle);

    assert.ok(first !== undefined);
    game.spells.giveStats(first);
    game.spells.giveStats(undefined);
    hero.stats[STATS.id.power] = 20;

    const handle = game.spells.cast(hero, game.id.surge).handle;

    assert.equal(game.spells.get(handle)?.stats, first.stats);
    assert.deepEqual(first.stats, { power: 20, hurt: 20 });

    const second = game.spells.copyStats(handle);

    assert.ok(second !== undefined);
    assert.notEqual(second, first);
    assert.deepEqual(second.stats, { power: 20, hurt: 20 });
  });
});

describe('auto intervals read at the cast', () => {
  it('throws for an interval function that answers 0, a negative or a non-finite number, and keeps no record', () => {
    for (const seconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const game = makeSpellGame({
        swing: spell({ activation: { kind: 'auto', interval: () => seconds }, release: () => [mark('swing')] })
      });

      const hero = game.unit(1);

      assert.throws(
        () => game.spells.cast(hero, game.id.swing),
        (error) =>
          error instanceof RangeError && error.message.includes(`an auto interval must be above 0; got ${seconds}`)
      );
      assert.deepEqual([game.spells.pool.live, game.log], [0, []]);
    }
  });

  it('takes the stats a refusing gate skipped before an interval function reads them', () => {
    const game = makeSpellGame(
      {
        volley: spell({
          activation: { kind: 'auto', interval: (ctx) => ctx.stats.interval },
          stats: { interval: scaled(2, add('power', 0.1)) },
          release: () => [mark('volley')]
        })
      },
      { host: { canAct: () => false } }
    );

    const hero = game.unit(1);
    const report = game.spells.cast(hero, game.id.volley);

    assert.equal(report.status, 'refused');
    assert.equal(report.refusal, 'gate');
    assert.deepEqual(game.log, []);

    game.step();
    game.spells.stepAuto(hero);
    assert.equal(game.spells.autoClock(hero, game.id.volley), 3);
  });
});
