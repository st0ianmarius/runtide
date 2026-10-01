import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auraId, makeUnitGame, type UnitTestGame } from '../helpers/unit-game.ts';

test('a spell cast from onIncomingAura lands its own cooldown without overwriting the outer one', () => {
  const late: { game?: UnitTestGame<'hero', 'outer' | 'inner'> } = {};

  const game = makeUnitGame(
    { hero: {} },
    {
      spells: {
        outer: { activation: { kind: 'trigger' }, cooldown: { aura: 'slow', seconds: 5 }, release: () => undefined },
        inner: { activation: { kind: 'trigger' }, cooldown: { aura: 'root', seconds: 7 }, release: () => undefined }
      },

      onIncomingAura: (_units, unit, application) => {
        const g = late.game;

        if (g !== undefined && application.aura === auraId('slow')) {
          g.spells.cast(unit, g.spellId.inner);
        }

        return undefined;
      }
    }
  );

  late.game = game;

  const hero = game.units.spawn(game.id.hero, { side: 1 });

  game.spells.cast(hero, game.spellId.outer);
  assert.equal(game.spells.cooldownLeft(hero, game.spellId.outer), 5);
  assert.equal(game.spells.cooldownLeft(hero, game.spellId.inner), 7);
});
