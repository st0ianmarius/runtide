import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, STATS, type UnitGame } from '../helpers/unit-game.ts';

const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: { tags: ['horde'] },
  elite: { tags: ['elite'], traits: { knockResist: { factor: 0.5, cap: 1.5 } } },
  boss: { tags: ['boss'], traits: { pullImmune: true, holdsGround: true } },
  wall: { traits: { immovable: true, inert: true } },
} satisfies Record<string, UnitDef<UnitGame>>;

describe('every unit folds (§II.6 M9)', () => {
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

describe('the resource policy (§II.6 M7)', () => {
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

describe('the damage host (§II.6 D5)', () => {
  it('takes blows off health, and a lethal one leaves the unit dead with a death and a kill', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    game.damage.hit({ target: grunt, attacker: hero, amount: 30 });
    assert.equal(grunt.health, 70);
    game.damage.hit({ target: grunt, attacker: hero, amount: 100 });
    assert.equal(grunt.lifecycle, 'dead');
    assert.deepEqual(game.log.slice(2), ['death 2', 'kill by 1', 'changed 2 standing>dead']);
  });

  it('gives an inert unit no death event and no kill', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const wall = game.units.spawn(game.id.wall, { side: 1 });

    game.damage.hit({ target: wall, attacker: hero, amount: 500 });
    assert.equal(wall.lifecycle, 'dead');
    assert.deepEqual(game.log.slice(2), ['changed 2 standing>dead']);
  });
});

describe('forces and traits (§II.6 D4)', () => {
  it('leaves an immovable unit, pulls no pull-immune one, and scales and caps a resisting one', () => {
    const game = makeUnitGame(TEMPLATES);

    const [grunt, elite, boss, wall] = [game.id.grunt, game.id.elite, game.id.boss, game.id.wall].map((template) =>
      game.units.spawn(template, { side: 1 }),
    );

    for (const unit of [grunt, elite, boss, wall]) {
      if (unit !== undefined) {
        game.damage.force({ target: unit, strength: 4, kind: 'pull' });
        game.damage.force({ target: unit, strength: 2, kind: 'knock' });
      }
    }

    assert.deepEqual(game.log.slice(4), ['force 1 4', 'force 1 2', 'force 2 1.5', 'force 2 1', 'force 3 2']);
  });

  it('holds a unit that holds its ground while it casts', () => {
    const game = makeUnitGame(TEMPLATES);
    const boss = game.units.spawn(game.id.boss, { side: 1 });

    game.spells.cast(boss, game.spellId.channel);
    game.damage.force({ target: boss, strength: 2, kind: 'knock' });
    assert.deepEqual(game.log.slice(1), []);
  });
});

describe('aura application rules (§II.6 A2)', () => {
  it('refuses, substitutes, scales and caps by class, and arms an immunity window', () => {
    const game = makeUnitGame(TEMPLATES, {
      rules: [
        { aura: auraId('stun'), tags: ['boss'], refuse: true },
        { aura: auraId('freeze'), tags: ['boss'], instead: auraId('slow') },
        {
          aura: auraId('freeze'),
          tags: ['elite'],
          scale: 0.5,
          cap: 0.75,
          immunity: { aura: auraId('freezeImmune'), share: 2 },
        },
      ],
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

    const tags = ['boss' as const];

    Reflect.set(tags, 0, 'dragon');
    assert.throws(() => units.auraPolicy([{ aura: auraId('stun'), tags }]), /no unit tag named dragon/);
  });
});
