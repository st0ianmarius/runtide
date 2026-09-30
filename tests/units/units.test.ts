import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineUnits, IMMOVABLE, INERT, type UnitDef } from '../../src/units/index.ts';
import { AURA_TAGS, auraId, HEARD, makeUnitGame, STATS, UNIT_TAGS, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero with no auto-attack, a grunt, an elite, a boss, a wall and a totem. */
const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: { stats: { speed: 4 }, tags: ['horde'], autoAttack: 'swing', data: { souls: 1 } },
  elite: { tags: ['elite'], traits: { knockResist: { factor: 0.5, cap: 1.5 } } },
  boss: { tags: ['boss'], traits: { pullImmune: true, holdsGround: true } },
  wall: { tags: ['objective'], traits: { immovable: true, inert: true } },
} satisfies Record<string, UnitDef<UnitGame>>;

describe('unit templates (§II.6 U1, U2)', () => {
  it('lay out base stats, trait bits, force resistance and class tags at load', () => {
    const units = defineUnits<UnitGame, keyof typeof TEMPLATES>(TEMPLATES, { stats: STATS, tags: UNIT_TAGS });
    const { id } = units;

    assert.equal(units.bases[id.hero]?.[STATS.id.maxHealth], 200);
    assert.equal(units.bases[id.grunt]?.[STATS.id.maxHealth], 100);
    assert.equal(units.bases[id.grunt]?.[STATS.id.speed], 4);
    assert.equal(units.traits[id.elite], 0);
    assert.equal(units.traits[id.wall], IMMOVABLE | INERT);
    assert.deepEqual(units.get(id.grunt).data, { souls: 1 });
    assert.deepEqual([units.knockFactor[id.elite], units.knockCap[id.elite]], [0.5, 1.5]);
    assert.equal(units.knockCap[id.grunt], Infinity);
    assert.equal(units.tagSets[id.boss]?.has(UNIT_TAGS.id.boss), true);
  });

  it('refuse unknown stats and tags, unsound numbers and force resistance', () => {
    const bad = (def: UnitDef<UnitGame>) => () =>
      defineUnits<UnitGame, 'bad'>({ bad: def }, { stats: STATS, tags: UNIT_TAGS });

    const forged: UnitDef<UnitGame> = {};

    Reflect.set(forged, 'stats', { luck: 3 });
    assert.throws(bad(forged), /Unit bad: there is no stat named luck/);
    assert.throws(bad({ stats: { speed: Number.NaN } }), /its speed must be a finite number/);
    Reflect.set(forged, 'stats', undefined);
    Reflect.set(forged, 'tags', ['dragon']);
    assert.throws(bad(forged), /there is no unit tag named dragon/);
    assert.throws(bad({ traits: { knockResist: { factor: -1 } } }), /knock resist takes a factor and a cap from 0/);
  });
});

describe('spawning (§II.6 U1)', () => {
  it('makes a living unit at full health with its own ids, stats snapshotted and an optional auto-attack, armed', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });
    const grunt = units.spawn(game.id.grunt, { side: 1, owner: hero, stats: { maxHealth: 60 } });

    assert.deepEqual([hero.id, grunt.id, grunt.side, grunt.owner], [1, 2, 1, hero]);
    assert.deepEqual([hero.lifecycle, hero.health, grunt.health], ['alive', 200, 60]);
    assert.equal(units.statsOf(grunt).total(STATS.id.speed), 4);
    assert.equal(units.autoAttackOf(hero), undefined);
    assert.equal(units.autoAttackOf(grunt), game.spellId.swing);
    assert.deepEqual(
      [game.spells.arm(grunt, game.spellId.swing), game.spells.arm(hero, game.spellId.swing)],
      [false, true],
    );
    assert.equal(units.hasTag(grunt, 'horde'), true);
    assert.equal(units.byId(2), grunt);
    assert.equal(units.live(), 2);
    assert.equal(hero.loadout.size, 0);
    assert.deepEqual(grunt.ext, { marks: 0, made: `${game.id.grunt}/1` });
    assert.throws(() => units.spawn(game.id.grunt, { side: 1, id: 2 }), /entity id 2 is already a live unit/);
    assert.deepEqual(game.log, ['spawned 1 alive>alive', 'spawned 2 alive>alive']);
  });
});

describe('the lifecycle (§II.6 U3)', () => {
  it('moves between states as each allows, entering the aura states and raising events', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });

    auras.apply(hero, auraId('mark'));
    assert.equal(units.revive(hero), false);
    assert.equal(units.kill(hero), true);
    assert.equal(units.kill(hero), false);
    assert.equal(auras.has(hero, auraId('mark')), false);
    assert.equal(units.revive(hero, 50), true);
    assert.equal(hero.health, 50);
    assert.equal(units.kill(hero), true);
    assert.equal(units.revive(hero), true);
    assert.equal(hero.health, 200);
    assert.equal(units.despawn(hero), true);
    assert.equal(units.despawn(hero), false);
    assert.equal(units.byId(hero.id), undefined);
    assert.equal(units.live(), 0);

    assert.deepEqual(game.log.slice(1), [
      'changed 1 alive>dead',
      'changed 1 dead>alive',
      'changed 1 alive>dead',
      'changed 1 dead>alive',
      'despawned 1 alive>despawned',
    ]);
  });
});

describe('bearer states on the lifecycle (§II.6 U3, D5)', () => {
  it("lets a unit's auras hear its death however it dies, and its despawn, before those removed on it go", () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras, damage } = game;
    const spawn = (id: (typeof game.id)[keyof typeof TEMPLATES]) => units.spawn(id, { side: 1 });
    const [hero, grunt, wall] = [spawn(game.id.hero), spawn(game.id.grunt), spawn(game.id.wall)];

    HEARD.length = 0;

    for (const unit of [hero, grunt, wall]) {
      auras.apply(unit, auraId('mark'));
    }

    units.kill(hero);
    damage.hit({ target: grunt, amount: 500 });
    units.despawn(wall);
    assert.deepEqual(HEARD, [`dead ${hero.id}`, `dead ${grunt.id}`, `despawned ${wall.id}`]);
    assert.equal(auras.has(grunt, auraId('mark')), false);
  });
});

describe('derived states (§I.7.1 F13)', () => {
  it('reads states from aura tags: a stun blocks acting and moving, a root or a freeze moving only', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras, spells } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });

    assert.deepEqual([units.canAct(hero), units.canMove(hero), units.is(hero, 'stunned')], [true, true, false]);
    auras.apply(hero, auraId('freeze'));
    assert.deepEqual([units.canAct(hero), units.canMove(hero), units.is(hero, 'rooted')], [true, false, true]);
    auras.apply(hero, auraId('stun'));
    assert.deepEqual([units.canAct(hero), units.is(hero, 'stunned')], [false, true]);
    assert.equal(spells.cast(hero, game.spellId.channel).refusal, 'gate');
    auras.removeByTag(hero, AURA_TAGS.id.stun);
    units.kill(hero);
    assert.equal(units.canAct(hero), false);
  });
});
