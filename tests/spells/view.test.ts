import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAST_STAGES, type CastView } from '../../src/spells/index.ts';
import { makeSpellGame, spell } from '../helpers/spell-game.ts';

describe('cast views', () => {
  it('fills the spell, rank, stage, the stamp its stage ends on and the press key, and nothing once it ended', () => {
    const game = makeSpellGame({
      bolt: spell({
        ranks: 2,
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, recover: { seconds: 0.5 } },
        release: () => undefined
      })
    });

    const caster = game.unit(3);

    game.step(4);

    const { handle } = game.spells.cast(caster, game.id.bolt, { rank: 2, source: 9, key: 14 });

    const view: CastView = {
      spell: game.id.bolt,
      rank: 0,
      stage: 0,
      seconds: 0,
      end: 0,
      started: 0,
      caster: 0,
      source: 0,
      key: 0
    };

    assert.equal(game.spells.viewOf(handle, view), true);
    assert.deepEqual(view, {
      spell: game.id.bolt,
      rank: 2,
      stage: CAST_STAGES.indexOf('windup'),
      seconds: 1,
      end: 8,
      started: 4,
      caster: 3,
      source: 9,
      key: 14
    });

    game.step();
    game.spells.step(caster);
    game.spells.viewOf(handle, view);
    assert.equal(view.end, 8);
    game.spells.pause(handle);
    game.spells.viewOf(handle, view);
    assert.equal(view.end, Infinity);
    game.spells.cancel(handle);
    assert.equal(game.spells.viewOf(handle, view), false);
  });
});

describe('cast views at a stage’s end', () => {
  it('report a running stage with nothing left as ending on the next step, when it does', () => {
    const game = makeSpellGame({
      bolt: spell({ activation: { kind: 'trigger' }, timeline: { windup: { seconds: 1 } }, release: () => undefined })
    });

    const hero = game.unit(1);
    const { handle } = game.spells.cast(hero, game.id.bolt);

    const view: CastView = {
      spell: game.id.bolt,
      rank: 0,
      stage: 0,
      seconds: 0,
      end: 0,
      started: 0,
      caster: 0,
      source: 0,
      key: 0
    };

    game.spells.delay(handle, -5);
    game.spells.viewOf(handle, view);
    assert.equal(view.end, game.clock.tick + 1);
  });
});
