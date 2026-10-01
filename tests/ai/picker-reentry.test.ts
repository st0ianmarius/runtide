import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeUnitGame } from '../helpers/unit-game.ts';

test('a nested AI pick preserves the outer candidates weights', () => {
  const g = makeUnitGame({ owner: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const pool = [g.spellId.swing, g.spellId.channel];

  const picked = g.ai.pick(owner, pool, {
    random: () => 0.75,

    weight: (_u, spell) => {
      if (spell === g.spellId.channel) {
        g.ai.pick(owner, pool, { random: () => 0, weight: () => 1 });
        return 1;
      }
      return 100;
    }
  });

  assert.equal(picked, g.spellId.swing);
});

for (const hook of ['allows', 'random', 'inputOf'] as const) {
  test(`a nested AI pick from ${hook} preserves the outer draw`, () => {
    const g = makeUnitGame({ owner: {} });
    const owner = g.units.spawn(g.id.owner, { side: 1 });
    const pool = [g.spellId.swing, g.spellId.channel];
    const nested = () => g.ai.pick(owner, pool, { random: () => 0, weight: () => 1 });

    const picked = g.ai.pick(owner, pool, {
      random: () => {
        if (hook === 'random') {
          nested();
        }
        return 0.75;
      },

      allows: (_unit, spell) => {
        if (hook === 'allows' && spell === g.spellId.channel) {
          nested();
        }
        return true;
      },

      inputOf: (_unit, spell) => {
        if (hook === 'inputOf' && spell === g.spellId.channel) {
          nested();
        }
        return undefined;
      },

      weight: (_unit, spell) => (spell === g.spellId.swing ? 100 : 1)
    });

    assert.equal(picked, g.spellId.swing);
  });
}

test('a throwing nested pick does not corrupt the next pick', () => {
  const g = makeUnitGame({ owner: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const pool = [g.spellId.swing, g.spellId.channel];
  assert.throws(
    () =>
      g.ai.pick(owner, pool, {
        random: () => {
          g.ai.pick(owner, pool, {
            random: () => {
              throw new Error('draw');
            }
          });
          return 0;
        }
      }),
    /draw/
  );
  assert.equal(g.ai.pick(owner, pool, { random: () => 0.75 }), g.spellId.channel);
});
