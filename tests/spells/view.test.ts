import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAST_STAGES } from '../../src/spells/index.ts';
import { makeSpellGame, spell } from '../helpers/spell-game.ts';

describe('cast views', () => {
  it('carries the spell, rank, stage and the stamp its stage ends on, and nothing once it ended', () => {
    const game = makeSpellGame({
      bolt: spell({
        ranks: 2,
        activation: { kind: 'trigger' },
        timeline: { windup: { seconds: 1 }, recover: { seconds: 0.5 } },
        release: () => undefined,
      }),
    });

    const caster = game.unit(3);

    game.step(4);

    const { handle } = game.spells.cast(caster, game.id.bolt, { rank: 2, source: 9 });

    assert.deepEqual(game.spells.viewOf(handle), {
      spell: game.id.bolt,
      rank: 2,
      stage: CAST_STAGES.indexOf('windup'),
      seconds: 1,
      end: 8,
      started: 4,
      caster: 3,
      source: 9,
    });

    game.step();
    game.spells.step(caster);
    assert.equal(game.spells.viewOf(handle)?.end, 8);
    game.spells.pause(handle);
    assert.equal(game.spells.viewOf(handle)?.end, Infinity);
    game.spells.cancel(handle);
    assert.equal(game.spells.viewOf(handle), undefined);
  });
});
