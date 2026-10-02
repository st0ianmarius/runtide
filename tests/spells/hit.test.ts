import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NO_CAST, type StatsContext } from '../../src/spells/index.ts';
import { CUES, type Game, makeSpellGame, mark, spell, STATS } from '../helpers/spell-game.ts';

/** A spell over a one-second windup whose hits mark each unit caught, with a hit cue sized by how many. */
const volley = spell({
  activation: { kind: 'trigger' },
  timeline: { windup: { seconds: 1 } },
  cues: { hit: (_ctx, hit) => ({ cue: CUES.id.cast, params: { size: hit.targets.length } }) },
  release: () => undefined,
  onHit: (_ctx, hit) => hit.targets.map((unit) => mark(`caught ${unit.id}`))
});

describe('spell hits', () => {
  it('runs onHit once with every unit caught, after its cue and before the hit event, and counts the procs that went off', () => {
    const game = makeSpellGame({ volley });
    const [hero, a, b] = [game.unit(1), game.unit(100), game.unit(101)];
    const handle = game.spells.cast(hero, game.id.volley).handle;

    game.log.length = 0;

    const went = game.spells.hit(handle, { targets: [a, b], target: undefined });

    assert.equal(went, 2);
    assert.deepEqual(game.log, ['caught 100@1', 'caught 101@1', 'hit volley@1']);
    assert.equal(game.cues.count, 1);
    assert.equal(game.cues.events[0]?.owner, 1);
    assert.equal(game.spells.isRunning(handle), true);
  });

  it('answers 0 and runs nothing for a stale handle', () => {
    const game = makeSpellGame({ volley, bolt: spell({ activation: { kind: 'trigger' }, release: () => undefined }) });
    const hero = game.unit(1);
    const ended = game.spells.cast(hero, game.id.bolt).handle;

    game.log.length = 0;

    assert.equal(game.spells.hit(ended, { targets: [game.unit(100)], target: undefined }), 0);
    assert.equal(game.spells.hit(NO_CAST, { targets: [game.unit(101)], target: undefined }), 0);
    assert.deepEqual([game.log, game.cues.count], [[], 0]);
  });

  it('answers 0 for a spell with no onHit, and still raises the hit event', () => {
    const game = makeSpellGame({
      plain: spell({ activation: { kind: 'trigger' }, timeline: { windup: { seconds: 1 } }, release: () => undefined })
    });

    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.plain).handle;

    game.log.length = 0;

    assert.equal(game.spells.hit(handle, { targets: [game.unit(100)], target: undefined }), 0);
    assert.deepEqual(game.log, ['hit plain@1']);
  });

  it("reads a live spell's stats again before onHit, so a hit sees its caster's stats as they are", () => {
    const seen: number[] = [];

    const game = makeSpellGame({
      surge: spell({
        activation: { kind: 'trigger' },
        live: true,
        stats: (ctx: StatsContext<Game>) => ({ power: ctx.view?.total(STATS.id.power) ?? 0 }),
        timeline: { windup: { seconds: 1 } },
        release: () => undefined,

        onHit: (ctx) => {
          seen.push(ctx.stats.power);

          return undefined;
        }
      })
    });

    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.surge).handle;

    hero.stats[STATS.id.power] = 25;
    game.spells.hit(handle, { targets: [], target: undefined });
    assert.deepEqual(seen, [25]);
  });

  it('hits an ended cast its retainer still holds, and answers 0 once the retainer lets it go', () => {
    const game = makeSpellGame({ volley });
    const hero = game.unit(1);
    const handle = game.spells.cast(hero, game.id.volley).handle;

    assert.equal(game.spells.retain(handle), true);
    for (let i = 0; i < 4; i++) {
      game.step();
      game.spells.step(hero);
    }

    assert.deepEqual([game.spells.isRunning(handle), game.spells.pool.live], [false, 1]);
    game.log.length = 0;

    assert.equal(game.spells.hit(handle, { targets: [game.unit(100)], target: undefined }), 1);
    assert.deepEqual(game.log, ['caught 100@1', 'hit volley@1']);

    game.spells.unretain(handle);
    assert.equal(game.spells.pool.live, 0);
    assert.equal(game.spells.hit(handle, { targets: [game.unit(101)], target: undefined }), 0);
  });
});
