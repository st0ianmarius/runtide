import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineSlots, type LoadoutState, MAX_SLOTS } from '../../src/abilities/index.ts';
import { toId } from '../../src/core/ids.ts';
import { add, ranks, scaled } from '../../src/modifiers/index.ts';
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

describe('button activation data (§II.3.2)', () => {
  it('refuses a negative cooldown, an unknown start and a cost that is not whole stacks', () => {
    assert.throws(() => makeAbilityGame({ bad: button({ cooldown: -1 }) }), /button cooldown takes seconds/);
    assert.throws(() => makeAbilityGame({ bad: forged('startsOn', 'release') }), /starts on 'activation' or 'cast'/);

    assert.throws(
      () => makeAbilityGame({ bad: button({ cost: { aura: auraNamed('charge'), stacks: 1.5 } }) }),
      /whole number of stacks/,
    );
  });

  it('refuses unknown tags, dead auras, unknown stats and per-rank lists that miss the ranks, at load', () => {
    assert.throws(() => makeAbilityGame({ bad: forged('requires', ['frozen']) }), /spell bad: there is no aura tag/);
    assert.throws(
      () => makeAbilityGame({ bad: button({ cost: { aura: toId<'auras'>(auraNamed('charge') + 99) } }) }),
      /not a live/,
    );

    assert.throws(
      () => makeAbilityGame({ bad: forged('applies', [{ aura: auraNamed('sprint'), scaledBy: 'luck' }]) }),
      /there is no stat named luck/,
    );

    assert.throws(
      () =>
        makeAbilityGame({
          bad: spell({ ranks: 2, activation: { kind: 'button', cooldown: scaled(ranks(8, 7, 6)) }, release }),
        }),
      /spell bad, cooldown: a per-rank list has 3 entries/,
    );

    assert.doesNotThrow(() =>
      makeAbilityGame({
        ok: spell({ ranks: 3, activation: { kind: 'button', cooldown: scaled(ranks(8, 7, 6)) }, release }),
      }),
    );
  });

  it('declares at most 31 slots, each cooling on a live aura', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_SLOTS + 1 }, (_unused, i) => [`s${i}`, {}]));

    assert.throws(() => defineSlots(many), /at most 31 slots/);
    assert.equal(defineSlots({ a: {}, b: {} }).id.b, 1);
  });
});

describe('loadouts (§I.6 Abilities)', () => {
  const game = makeAbilityGame({
    roll: button({ cooldown: 2 }),
    nova: spell({ ranks: 2, activation: { kind: 'button', cooldown: scaled(ranks(6, 5), add('power', 0)) }, release }),
    swing: spell({ activation: { kind: 'trigger' }, release }),
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

  it('refuses a spell that is not a button, a rank the spell lacks and a slot it does not have', () => {
    const hero = game.hero(2);

    assert.throws(() => {
      abilities.equip(hero, dodge, game.id.swing);
    }, /not a live button spell/);
    assert.throws(() => {
      abilities.equip(hero, skill, { spell: game.id.nova, rank: 3 });
    }, /nova has no rank 3/);
    assert.throws(() => {
      abilities.equip(hero, toId<'slots'>(7), game.id.roll);
    }, /7 is not a slot of the game's 3/);
  });

  it('refuses a cooldown on a slot without one, and a unit whose loadout it did not make', () => {
    const slots = defineSlots({ dodge: { cooldown: auraNamed('dodgeCooldown') }, skill: {}, ultimate: {} });
    const lone = makeAbilityGame({ roll: button({ cooldown: 2 }), free: button() }, { slots });
    const hero = lone.hero(1);
    const stray: LoadoutState = { size: 3 };

    assert.throws(() => {
      lone.abilities.equip(hero, skill, lone.id.roll);
    }, /roll has a cooldown, and slot skill has none/);
    lone.abilities.equip(hero, skill, lone.id.free);
    lone.abilities.equip(hero, dodge, lone.id.roll);
    assert.equal(lone.abilities.cooldownLeft(hero, skill), 0);
    assert.throws(() => lone.abilities.check({ ...hero, loadout: stray }, dodge), /abilities.createLoadout/);
  });

  it('refuses a slot cooling on an aura that is not live, by id or by name', () => {
    const slots = defineSlots({ dodge: { cooldown: toId<'auras'>(auraNamed('root') + 1) }, skill: {}, ultimate: {} });
    const named = defineSlots({ dodge: { cooldown: 'nope' }, skill: {}, ultimate: {} });

    assert.throws(() => makeAbilityGame({}, { slots }), /Slot dodge's cooldown: 7 is not a live aura/);
    assert.throws(() => makeAbilityGame({}, { slots: named }), /Slot dodge's cooldown: nope is not a live aura/);
  });

  it('takes a slot cooldown by the aura’s name', () => {
    const byId = defineSlots({ dodge: { cooldown: auraNamed('root') }, skill: {}, ultimate: {} });
    const byName = defineSlots({ dodge: { cooldown: 'root' }, skill: {}, ultimate: {} });

    assert.deepEqual(
      makeAbilityGame({}, { slots: byName }).abilities.mirrorReads,
      makeAbilityGame({}, { slots: byId }).abilities.mirrorReads,
    );
    assert.equal(makeAbilityGame({}, { slots: byName }).abilities.mirrorReads.auras.includes(auraNamed('root')), true);
  });
});
