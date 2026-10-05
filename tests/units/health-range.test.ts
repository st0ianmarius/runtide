import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { revive, type UnitDef } from '../../src/units/index.ts';
import { auraId, makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero, a grunt at the stat table's 100 health, and a template with no health. */
const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: {},
  husk: { stats: { maxHealth: 0 } }
} satisfies Record<string, UnitDef<UnitGame>>;

describe('a unit’s health range', () => {
  it('holds what the damage host sets from 0 up to the maximum: an overkill, a share past it', () => {
    const game = makeUnitGame(TEMPLATES);
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    game.units.damageHost.setHealth(grunt, 250);
    assert.equal(grunt.health, 100);
    game.units.damageHost.setHealth(grunt, -50);
    assert.equal(grunt.health, 0);

    const other = game.units.spawn(game.id.grunt, { side: 1 });

    game.damage.hit({ target: other, amount: 150 });
    assert.deepEqual([other.lifecycle, other.health], ['dead', 0]);
  });

  it('refuses a spawn whose stats are not finite or whose maximum health is not above 0, making nothing', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => units.spawn(game.id.grunt, { side: 1, stats: { speed: value } }),
        /unit grunt's speed must be a finite number/
      );
      assert.throws(() => units.variant(game.id.grunt, { power: value }), /unit grunt's power must be a finite number/);
    }

    assert.throws(() => units.spawn(game.id.husk, { side: 1 }), /unit husk spawns with a maximum health of 0/);

    for (const maxHealth of [0, -5]) {
      assert.throws(() => units.spawn(game.id.grunt, { side: 1, stats: { maxHealth } }), /not a finite number above 0/);
      assert.throws(() =>
        units.spawn(game.id.grunt, { side: 1, variant: units.variant(game.id.grunt, { maxHealth }) })
      );
    }

    assert.equal(units.live(), 0);
    assert.equal(units.spawn(game.id.grunt, { side: 1 }).id, 1);
    assert.deepEqual(game.log, ['spawned 1 alive>alive']);
  });

  it('sets health to 0 as units.kill moves a unit to dead', () => {
    const game = makeUnitGame(TEMPLATES);
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });
    const seen: number[] = [];

    game.on('changed', (event) => seen.push(event.unit?.health ?? -1));
    assert.equal(game.units.kill(grunt), true);
    assert.deepEqual([grunt.lifecycle, grunt.health, seen], ['dead', 0, [0]]);
    assert.equal(game.units.kill(grunt), false);
    assert.equal(game.units.revive(grunt), true);
    assert.equal(grunt.health, 100);
  });

  it('leaves a living unit at 0, not below, when its maximum moves its health there, and hands it to onLethal', () => {
    const lethal: number[] = [];
    const late: { game?: ReturnType<typeof makeUnitGame<keyof typeof TEMPLATES>> } = {};

    const make = (onLethal?: (unit: UnitGame['bearer']) => void) =>
      makeUnitGame(TEMPLATES, {
        policy: () => -5,
        ...(onLethal === undefined ? {} : { onLethal })
      });

    // An onLethal that leaves it be: it stays alive at 0.
    const quiet = make(() => undefined);
    const hero = quiet.units.spawn(quiet.id.hero, { side: 0 });

    quiet.auras.apply(hero, auraId('vigour'));
    assert.equal(quiet.units.syncHealth(hero), 0);
    assert.deepEqual([hero.lifecycle, hero.health], ['alive', 0]);

    // None of the game's: createGame's, the damage system's kill.
    const fallen = make();
    const victim = fallen.units.spawn(fallen.id.hero, { side: 0 });

    fallen.auras.apply(victim, auraId('vigour'));
    assert.equal(fallen.units.syncHealth(victim), 0);
    assert.deepEqual([victim.lifecycle, victim.health], ['dead', 0]);
    assert.ok(fallen.log.includes(`death ${victim.id}`));

    late.game = make((unit) => {
      lethal.push(unit.id);
      late.game?.damage.kill(unit);
    });

    const { game } = late;
    const other = game.units.spawn(game.id.hero, { side: 0 });

    game.auras.apply(other, auraId('vigour'));
    assert.equal(game.units.syncHealth(other), 0);
    assert.deepEqual([lethal, other.lifecycle], [[other.id], 'dead']);
    assert.ok(game.log.includes(`death ${other.id}`));
  });

  it('revives at a share of the maximum through the revive proc', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });

    game.units.kill(hero);
    assert.equal(
      game.procs.apply(revive<UnitGame>({ health: { share: 0.3 } }), { self: hero, target: hero }).status,
      'landed'
    );
    assert.deepEqual([hero.lifecycle, hero.health], ['alive', 60]);

    for (const share of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => game.procs.prepare([revive<UnitGame>({ health: { share } })], 'Test'),
        /health is a finite number above 0, as is its share/
      );
    }
  });
});
