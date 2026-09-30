import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, STATS, type UnitGame } from '../helpers/unit-game.ts';

const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: { tags: ['horde'] },
  elite: { tags: ['elite'] },
  boss: { tags: ['boss'] },
  wall: {},
} satisfies Record<string, UnitDef<UnitGame>>;

describe('every unit folds', () => {
  it('folds its snapshotted bases with its auras’ modifiers, the unit as the host', () => {
    const game = makeUnitGame(TEMPLATES);
    const grunt = game.units.spawn(game.id.grunt, { side: 1, stats: { speed: 3 } });

    assert.equal(game.units.statsOf(grunt).total(STATS.id.speed), 3);
    game.auras.apply(grunt, auraId('haste'));
    assert.equal(game.units.statsOf(grunt).total(STATS.id.speed), 6);
  });

  it('reads the bases alone without a modifier system', () => {
    const game = makeUnitGame(TEMPLATES, { folds: false });
    const hero = game.units.spawn(game.id.hero, { side: 0, stats: { speed: 7 } });

    assert.equal(game.units.statsOf(hero).total(STATS.id.speed), 7);
    assert.equal(hero.health, 200);
  });
});

describe('the resource policy', () => {
  it('heals a gain through the heal pipeline and scales a loss, by default', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });

    game.damage.hit({ target: hero, amount: 100 });
    game.auras.apply(hero, auraId('vigour'));
    assert.equal(game.units.syncHealth(hero), 150);
    assert.equal(hero.maxHealth, 250);
    game.auras.remove(hero, auraId('vigour'));
    assert.equal(game.units.syncHealth(hero), 120);
    assert.equal(game.units.syncHealth(hero), 120);
  });

  it('keeps or scales health, or follows the game’s own rule', () => {
    const run = (policy: Parameters<typeof makeUnitGame>[1]) => {
      const game = makeUnitGame(TEMPLATES, policy);
      const hero = game.units.spawn(game.id.hero, { side: 0 });

      game.damage.hit({ target: hero, amount: 100 });
      game.auras.apply(hero, auraId('vigour'));

      const gained = game.units.syncHealth(hero);

      game.auras.apply(hero, auraId('frail'));

      return [gained, game.units.syncHealth(hero)];
    };

    assert.deepEqual(run({ policy: 'keep' }), [100, 100]);
    assert.deepEqual(run({ policy: 'scale' }), [125, 62.5]);
    assert.deepEqual(run({ policy: (_unit, _before, after) => after / 2 }), [125, 62.5]);
  });
});

describe('the damage host', () => {
  it('takes blows off health, and a lethal one leaves the unit dead with a death and a kill', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    game.damage.hit({ target: grunt, attacker: hero, amount: 30 });
    assert.equal(grunt.health, 70);
    game.damage.hit({ target: grunt, attacker: hero, amount: 100 });
    assert.equal(grunt.lifecycle, 'dead');
    assert.deepEqual(game.log.slice(2), ['death 2', 'kill by 1', 'changed 2 alive>dead']);
  });

  it('gives a wall a death event and a kill like any unit: its rewards are the game’s to leave out', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const wall = game.units.spawn(game.id.wall, { side: 1 });

    game.damage.hit({ target: wall, attacker: hero, amount: 500 });
    assert.equal(wall.lifecycle, 'dead');
    assert.deepEqual(game.log.slice(2), ['death 2', 'kill by 1', 'changed 2 alive>dead']);
  });
});

describe('an aura application policy', () => {
  it('is the game’s own onIncomingAura: it refuses, substitutes and caps by unit class', () => {
    const game = makeUnitGame(TEMPLATES, {
      onIncomingAura: (units, unit, application) => {
        if (application.aura === auraId('stun') && units.hasTag(unit, 'boss')) {
          return { refuse: true };
        }

        if (application.aura === auraId('freeze') && units.hasTag(unit, 'boss')) {
          return { apply: { ...application, aura: auraId('slow') } };
        }

        return application.aura === auraId('freeze') && units.hasTag(unit, 'elite')
          ? { apply: { ...application, duration: 0.75 }, after: [{ aura: auraId('freezeImmune'), duration: 1.5 }] }
          : undefined;
      },
    });

    const { auras, units } = game;

    const [grunt, elite, boss] = [game.id.grunt, game.id.elite, game.id.boss].map((template) =>
      units.spawn(template, { side: 1 }),
    );

    assert.ok(grunt !== undefined && elite !== undefined && boss !== undefined);
    assert.equal(auras.apply(boss, auraId('stun')).applied, false);
    auras.apply(boss, auraId('freeze'));
    assert.deepEqual([auras.has(boss, auraId('freeze')), auras.has(boss, auraId('slow'))], [false, true]);
    auras.apply(elite, auraId('freeze'));
    assert.equal(auras.remaining(elite, auraId('freeze')), 0.75);
    assert.equal(auras.remaining(elite, auraId('freezeImmune')), 1.5);
    auras.remove(elite, auraId('freeze'));
    assert.equal(auras.apply(elite, auraId('freeze')).applied, false);
    auras.apply(grunt, auraId('freeze'));
    assert.equal(auras.remaining(grunt, auraId('freeze')), 2);
  });
});
