import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDamageSystem, defineDamageKinds } from '../../src/damage/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

describe('a game-owned downed state', () => {
  it('keeps a downable unit reachable at 0 health, while ordinary deaths and lifecycle guards still work', () => {
    const game = makeUnitGame({ hero: {}, grunt: {} });
    const { units } = game;

    const damage = createDamageSystem<UnitGame>({
      auras: game.auras,
      kinds: defineDamageKinds({ physical: {} }),
      isDead: (health, unit) => health <= 0 && unit.template !== game.id.hero,
      host: {
        ...units.damageHost,
        setHealth: (unit, health) => {
          units.damageHost.setHealth(unit, Math.max(0, health));
        }
      }
    });

    const hero = units.spawn(game.id.hero, { side: 0 });
    const grunt = units.spawn(game.id.grunt, { side: 1 });

    assert.equal(damage.hit({ target: hero, amount: 150 }).hasKilled, false);
    assert.deepEqual([hero.lifecycle, hero.health, damage.isDead(hero)], ['alive', 0, false]);
    assert.equal(units.revive(hero, 30), false);
    assert.equal(damage.hit({ target: hero, amount: 10 }).status, 'landed');
    assert.equal(damage.heal({ target: hero, amount: 30 }).status, 'landed');
    assert.equal(hero.health, 30);
    assert.equal(damage.setHealth(hero, 0).hasKilled, false);
    assert.equal(damage.setHealth(hero, 40).status, 'landed');
    assert.equal(hero.health, 40);

    assert.equal(damage.hit({ target: grunt, amount: 150 }).hasKilled, true);
    assert.equal(grunt.lifecycle, 'dead');
    const other = units.spawn(game.id.grunt, { side: 1 });

    assert.equal(damage.setHealth(other, 0).hasKilled, true);
    assert.equal(other.lifecycle, 'dead');

    damage.setHealth(hero, 0);
    assert.equal(units.kill(hero), true);
    assert.equal(damage.isDead(hero), true);
    assert.equal(damage.hit({ target: hero, amount: 10 }).status, 'skipped');
    assert.equal(damage.heal({ target: hero, amount: 10 }).status, 'skipped');
    assert.equal(damage.setHealth(hero, 40).status, 'skipped');
    assert.equal(units.revive(hero, 40), true);
    assert.deepEqual([hero.lifecycle, hero.health], ['alive', 40]);
  });
});
