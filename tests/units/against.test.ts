import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, STATS, type UnitGame } from '../helpers/unit-game.ts';

const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: { tags: ['horde'] },
  elite: { tags: ['elite'] }
} satisfies Record<string, UnitDef<UnitGame>>;

/** A game with a hero (side 0), a grunt and an elite (side 1). */
const arena = () => {
  const game = makeUnitGame(TEMPLATES);
  const hero = game.units.spawn(game.id.hero, { side: 0 });
  const grunt = game.units.spawn(game.id.grunt, { side: 1 });
  const elite = game.units.spawn(game.id.elite, { side: 1 });

  return { game, hero, grunt, elite };
};

describe('modifiers conditioned on the target', () => {
  it('count only when the blow’s target meets them: +50% damage against elites', () => {
    const { game, hero, grunt, elite } = arena();

    game.auras.apply(hero, auraId('slayer'));

    assert.equal(game.damage.hit({ target: grunt, amount: 10, attacker: hero }).amount, 10);
    assert.equal(game.damage.hit({ target: elite, amount: 10, attacker: hero }).amount, 15);
  });

  it('read a value off the target: damage grows with the target’s missing health', () => {
    const { game, hero, grunt } = arena();

    game.auras.apply(hero, auraId('executioner'));

    assert.equal(game.damage.hit({ target: grunt, amount: 50, attacker: hero }).amount, 50);
    assert.equal(game.damage.hit({ target: grunt, amount: 10, attacker: hero }).amount, 15);
  });

  it('leave the unit’s own stats alone, kept totals and all, before and after a read against a target', () => {
    const { game, hero, elite } = arena();
    const might = STATS.id.might;

    game.auras.apply(hero, auraId('slayer'));
    game.auras.apply(hero, auraId('executioner'));
    elite.health = 50;

    assert.equal(game.units.statsOf(hero).total(might), 1);
    assert.equal(game.units.statsOf(hero, elite).total(might), 1.5 * 1.5);
    assert.equal(game.units.statsOf(hero).total(might), 1);
    assert.equal(game.units.statsOf(hero, elite).total(might), 1.5 * 1.5);
  });

  it('do not apply to a blow nobody deals', () => {
    const { game, hero, elite } = arena();

    game.auras.apply(elite, auraId('slayer'));

    assert.equal(game.damage.hit({ target: hero, amount: 10 }).amount, 10);
  });
});
