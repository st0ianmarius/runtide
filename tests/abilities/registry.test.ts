import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineSlots, type LoadoutState, MAX_SLOTS } from '../../src/abilities/index.ts';
import { toId } from '../../src/core/ids.ts';
import type { AnySpellDef, ButtonActivation } from '../../src/spells/index.ts';
import { type AbilityGame, auraNamed, makeAbilityGame, spell } from '../helpers/ability-game.ts';

/** A release that does nothing. */
const release = (): undefined => undefined;

/** A button spell with some activation data and nothing else. */
const button = (data: Omit<ButtonActivation<AbilityGame>, 'kind'> = {}): AnySpellDef<AbilityGame> =>
  spell({ activation: { kind: 'button', ...data }, release });

/** A button activation with a field the types refuse, set anyway (a forged definition). */
const forged = (field: string, value: unknown): AnySpellDef<AbilityGame> => {
  const activation: ButtonActivation<AbilityGame> = { kind: 'button' };

  Reflect.set(activation, field, value);

  return spell({ activation, release });
};

describe('button activation data', () => {
  it('refuses an unknown commit moment, a checkCast that is not a function and a cost that is not whole stacks', () => {
    assert.throws(() => makeAbilityGame({ bad: forged('commitsOn', 'release') }), /commits on 'press' or 'cast'/);
    assert.throws(() => makeAbilityGame({ bad: forged('checkCast', true) }), /checkCast is a function/);

    assert.throws(
      () => makeAbilityGame({ bad: button({ cost: { aura: auraNamed('charge'), stacks: 1.5 } }) }),
      /whole number of stacks/
    );
  });

  it('refuses unknown tags and dead auras, at load', () => {
    assert.throws(() => makeAbilityGame({ bad: forged('requires', ['frozen']) }), /spell bad: there is no aura tag/);
    assert.throws(
      () =>
        makeAbilityGame({
          bad: button({ cost: { aura: toId<'auras'>(auraNamed('charge') + 99) } })
        }),
      /not a live/
    );
  });

  it('declares at most 31 slots, in press order', () => {
    const many = Array.from({ length: MAX_SLOTS + 1 }, (_unused, i) => `s${i}`);

    assert.throws(() => defineSlots(many), /at most 31 slots/);
    assert.equal(defineSlots(['a', 'b']).id.b, 1);
  });
});

describe('loadouts', () => {
  const game = makeAbilityGame({
    roll: spell({
      activation: { kind: 'button' },
      cooldown: { aura: 'dodgeCooldown', seconds: 2 },
      release
    }),
    nova: spell({ ranks: 2, activation: { kind: 'button' }, release }),
    swing: spell({ activation: { kind: 'trigger' }, release })
  });

  const { abilities } = game;
  const { dodge, skill, ultimate } = abilities.slots.id;

  it('puts button spells in slots, at a rank, and finds them again', () => {
    const hero = game.hero(1);

    assert.equal(abilities.abilityOf(hero, dodge), undefined);
    abilities.equip(hero, dodge, game.id.roll);
    abilities.equip(hero, skill, { spell: game.id.nova, rank: 2 });
    assert.equal(abilities.abilityOf(hero, dodge), game.id.roll);
    assert.equal(abilities.slotOf(hero, game.id.nova), skill);
    assert.equal(abilities.slotOf(hero, game.id.swing), undefined);
    abilities.equip(hero, dodge, undefined);
    assert.equal(abilities.abilityOf(hero, dodge), undefined);
    assert.equal(hero.loadout.size, 3);
    assert.deepEqual([dodge, skill, ultimate].map(abilities.bit), [1, 2, 4]);
  });

  it('refuses a spell that is not a button, a rank the spell lacks, a slot it does not have and a stray loadout', () => {
    const hero = game.hero(2);
    const stray: LoadoutState = { size: 3 };

    assert.throws(() => {
      abilities.equip(hero, dodge, game.id.swing);
    }, /not a live button spell/);
    assert.throws(() => {
      abilities.equip(hero, skill, { spell: game.id.nova, rank: 3 });
    }, /nova has no rank 3/);
    assert.throws(() => {
      abilities.equip(hero, toId<'slots'>(7), game.id.roll);
    }, /7 is not a slot of the game's 3/);
    assert.throws(() => abilities.check({ ...hero, loadout: stray }, dodge), /abilities.createLoadout/);
  });

  it('reads the button spells’ cooldowns and costs for the mirror, a shared aura once', () => {
    const shared = makeAbilityGame({
      roll: spell({
        activation: { kind: 'button' },
        cooldown: { aura: 'dodgeCooldown', seconds: 2 },
        release
      }),
      hop: spell({
        activation: { kind: 'button', cost: { aura: 'charge' } },
        cooldown: [{ aura: 'dodgeCooldown', seconds: 1 }, { aura: 'skillCooldown' }],
        release
      })
    });

    assert.deepEqual(
      shared.abilities.mirrorReads.auras,
      [auraNamed('dodgeCooldown'), auraNamed('skillCooldown'), auraNamed('charge')].toSorted((a, b) => a - b)
    );
  });
});
