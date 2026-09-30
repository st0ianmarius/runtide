import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { haste, ranks, scaled } from '../../src/modifiers/index.ts';
import { auraNamed, makeAbilityGame, spell, STATS } from '../helpers/ability-game.ts';

/** A release that does nothing. */
const release = (): undefined => undefined;

/** A test game over buttons with every kind of cooldown, and a spell that is not a button. */
const setUp = () =>
  makeAbilityGame({
    nova: spell({
      ranks: 2,
      activation: {
        kind: 'button',
        cooldown: scaled(ranks(8, 6), haste(1)),
        startsOn: 'cast',
        cost: { aura: 'charge', stacks: 2 },
        requires: ['stance'],
        blockedBy: ['rooted'],
        resets: ['cooldown.dodge'],
        applies: [{ aura: auraNamed('sprint'), scaledBy: 'duration' }, { aura: auraNamed('stance') }],
      },
      release,
    }),

    roll: spell({ activation: { kind: 'button', cooldown: 2 }, release }),
    timed: spell({ activation: { kind: 'button', cooldown: (hero, rank) => hero.id * rank }, release }),
    free: spell({ activation: { kind: 'button' }, release }),
    swing: spell({ activation: { kind: 'trigger' }, release }),
  });

describe('cooldown previews (§II.6 M6)', () => {
  it('reads a cooldown with no world from the bases, or from a caster’s stats, at any rank', () => {
    const game = setUp();
    const { abilities, id } = game;
    const hero = game.hero(3);

    hero.stats[STATS.id.abilityHaste] = 100;
    assert.equal(abilities.cooldownOf(undefined, id.nova), 8);
    assert.equal(abilities.cooldownOf(undefined, id.nova, 2), 6);
    assert.equal(abilities.cooldownOf(hero, id.nova, 2), 3);
    assert.equal(abilities.cooldownOf(undefined, id.roll), 2);
    assert.ok(Number.isNaN(abilities.cooldownOf(undefined, id.timed)));
    assert.equal(abilities.cooldownOf(hero, id.timed, 2), 6);
    assert.equal(abilities.cooldownOf(hero, id.free), 0);
    assert.equal(abilities.cooldownOf(hero, id.swing), 0);
  });
});

describe('button explanations (§II.6 M6)', () => {
  it('gives a button’s rules as ids and its cooldown as ratios, or with a caster’s readings', () => {
    const game = setUp();
    const { abilities, auras, id } = game;
    const hero = game.hero(1);
    const preview = abilities.explain(id.nova, 2);

    hero.stats[STATS.id.abilityHaste] = 100;

    const read = abilities.explain(id.nova, 2, hero)?.cooldown;

    assert.equal(preview?.kind, 'button');
    assert.equal(preview.startsOn, 'cast');
    assert.equal(preview.isComputed, false);
    assert.deepEqual(preview.cost, { aura: auraNamed('charge'), stacks: 2 });
    assert.deepEqual(preview.requires, [auras.tags.id.stance]);
    assert.deepEqual(preview.blockedBy, [auras.tags.id.rooted]);
    assert.deepEqual(preview.resets, [auras.tags.id['cooldown.dodge']]);

    assert.deepEqual(preview.applies, [
      { aura: auraNamed('sprint'), scaledBy: STATS.id.duration },
      { aura: auraNamed('stance'), scaledBy: undefined },
    ]);

    assert.ok(typeof preview.cooldown === 'object');
    assert.equal(preview.cooldown.base, 6);
    assert.equal(preview.cooldown.total, undefined);
    assert.ok(typeof read === 'object');
    assert.equal(read.total, 3);
  });

  it('gives a number as it is, marks a function as computed, and nothing for a spell that is not a button', () => {
    const game = setUp();
    const { abilities, id } = game;

    assert.deepEqual(abilities.explain(id.roll), {
      kind: 'button',
      cooldown: 2,
      isComputed: false,
      startsOn: 'activation',
      cost: undefined,
      requires: [],
      blockedBy: [],
      resets: [],
      applies: [],
    });

    assert.equal(abilities.explain(id.timed)?.isComputed, true);
    assert.equal(abilities.explain(id.timed)?.cooldown, undefined);
    assert.equal(abilities.explain(id.swing), undefined);
  });
});
