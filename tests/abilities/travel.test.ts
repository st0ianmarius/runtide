import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ButtonActivation, SpellContext } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, makeAbilityGame, spell } from '../helpers/ability-game.ts';

/** What the release hooks logged. */
const lines: string[] = [];

/** A release that logs the spell and its rank. */
const logRelease =
  (name: string) =>
  (ctx: SpellContext<AbilityGame>): undefined => {
    lines.push(`${name} rank ${ctx.rank}`);

    return undefined;
  };

/** A button spell that logs its release. */
const button = (name: string, data: Omit<ButtonActivation<AbilityGame>, 'kind'> = {}, spellRanks = 1) =>
  spell({ ranks: spellRanks, activation: { kind: 'button', ...data }, release: logRelease(name) });

/** A test game over the trigger path's abilities, and a hero. */
const setUp = () => {
  lines.length = 0;

  const game = makeAbilityGame({
    roll: button('roll', {
      cooldown: 2,
      applies: [{ aura: auraNamed('sprint') }],
      cost: { aura: auraNamed('charge') },

      activate: () => {
        lines.push('activate');
      },

      travel: () => {
        lines.push('travel roll');
      },
    }),

    nova: button('nova', {}, 2),
    guard: button('guard', { requires: ['stance'] }),
    swing: spell({ activation: { kind: 'trigger' }, release: logRelease('swing') }),

    hop: button('hop', {
      travel: () => {
        lines.push('travel hop');
      },
    }),
  });

  return { game, hero: game.hero(1) };
};

describe('travel', () => {
  it('runs every equipped ability’s travel hook in slot order', () => {
    const { game, hero } = setUp();
    const { abilities } = game;

    abilities.equip(hero, abilities.slots.id.ultimate, game.id.roll);
    abilities.equip(hero, abilities.slots.id.dodge, game.id.hop);
    abilities.travel(hero, 0.25);
    assert.deepEqual(lines, ['travel hop', 'travel roll']);
  });
});
