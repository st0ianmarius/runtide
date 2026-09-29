import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { useAbility } from '../../src/abilities/index.ts';
import { escapeReport } from '../../src/procs/index.ts';
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
    echo: spell({ activation: { kind: 'trigger' }, release: () => [useAbility<AbilityGame>('guard')] }),

    hop: button('hop', {
      travel: () => {
        lines.push('travel hop');
      },
    }),
  });

  return { game, hero: game.hero(1) };
};

describe('the trigger path (§II.6 S4)', () => {
  it('fires with no slot cooldown, pays and lands, and neither moves nor starts a cooldown', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;
    const { dodge } = abilities.slots.id;

    auras.apply(hero, { aura: auraNamed('charge'), stacks: 2 });
    abilities.equip(hero, dodge, game.id.roll);
    abilities.tryActivate(hero, abilities.bit(dodge));
    game.step();
    assert.equal(abilities.trigger(hero, game.id.roll), true);
    assert.equal(abilities.cooldownLeft(hero, dodge), 1.75);
    assert.equal(auras.stacks(hero, auraNamed('charge')), 0);
    assert.equal(auras.remaining(hero, auraNamed('sprint')), 2);
    assert.deepEqual(lines, ['activate', 'roll rank 1', 'roll rank 1']);
    assert.equal(abilities.trigger(hero, game.id.roll), false);
  });

  it('is gated by the ability’s own rules, casts at the rank of the slot holding it, and refuses other spells', () => {
    const { game, hero } = setUp();
    const { abilities, auras } = game;

    assert.equal(abilities.trigger(hero, game.id.guard), false);
    auras.apply(hero, auraNamed('stance'));
    assert.equal(abilities.trigger(hero, game.id.guard), true);
    abilities.trigger(hero, game.id.nova);
    abilities.equip(hero, abilities.slots.id.skill, { spell: game.id.nova, rank: 2 });
    abilities.trigger(hero, game.id.nova);
    assert.equal(abilities.trigger(hero, game.id.swing), false);
    assert.deepEqual(lines, ['guard rank 1', 'nova rank 1', 'nova rank 2']);
  });

  it('is the useAbility proc, refused when the rules refuse, and not a hatch in the escape report', () => {
    const { game, hero } = setUp();
    const { procs, auras } = game;

    assert.equal(procs.apply(useAbility<AbilityGame>('guard'), { self: hero }).status, 'refused');
    auras.apply(hero, auraNamed('stance'));
    game.spells.cast(hero, game.id.echo);
    assert.deepEqual(lines, ['guard rank 1']);
    assert.equal(procs.apply(useAbility<AbilityGame>('swing'), { self: hero }).status, 'refused');
    assert.throws(() => procs.prepare([useAbility<AbilityGame>('swing')], 'Test list'), /swing is not a live button/);
    assert.throws(() => procs.prepare([useAbility<AbilityGame>('nothing')], 'Test list'), /unknown spell nothing/);
    assert.deepEqual(escapeReport({ procs, spells: game.spells, abilities: game.abilities }).procKinds, []);
    assert.deepEqual(escapeReport({ procs, spells: game.spells }).procKinds, ['useAbility']);
  });
});

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
