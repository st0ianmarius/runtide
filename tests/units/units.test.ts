import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEntityIds, POOL_MIN_FREE } from '../../src/core/index.ts';
import { run } from '../../src/procs/index.ts';
import { after } from '../../src/spells/index.ts';
import { defineUnits, type UnitDef } from '../../src/units/index.ts';
import { AURA_TAGS, auraId, HEARD, makeUnitGame, STATS, UNIT_TAGS, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero with no auto-attack, a grunt, an elite, a boss, a wall and a totem. */
const TEMPLATES = {
  hero: { stats: { maxHealth: 200 } },
  grunt: { stats: { speed: 4 }, tags: ['horde'], autoAttack: 'swing', data: { souls: 1 } },
  elite: { tags: ['elite'] },
  boss: { tags: ['boss'] },
  wall: { tags: ['objective'] }
} satisfies Record<string, UnitDef<UnitGame>>;

describe('owned effects on leaving life', () => {
  for (const to of ['dead', 'despawned'] as const) {
    it(`ends dependent areas and withdraws delayed lists on ${to}, including lists from area end hooks`, () => {
      const gone: number[] = [];
      let landed = 0;

      const game = makeUnitGame(TEMPLATES, {
        areaTriggers: {
          ownerGone: (owner) => {
            gone.push(owner.id);
            game.procs.run([after(1, [])], { self: owner });

            return 1;
          }
        },
        spells: {
          delayed: {
            activation: { kind: 'trigger' },
            release: () => [
              after(1, [
                run('landed', () => {
                  landed += 1;
                })
              ])
            ]
          }
        }
      });

      const owner = game.units.spawn(game.id.hero, { side: 0 });
      const other = game.units.spawn(game.id.hero, { side: 0 });

      game.spells.cast(owner, game.spellId.delayed);
      game.spells.cast(other, game.spellId.delayed);
      assert.equal(game.spells.delayed.pending, 2);

      if (to === 'dead') {
        game.units.kill(owner);
      } else {
        game.units.despawn(owner);
      }

      assert.deepEqual(gone, [owner.id]);
      assert.equal(game.spells.delayed.pending, 1);
      for (let i = 0; i < 4; i++) {
        game.clock.step();
      }
      game.spells.stepDelayed();
      assert.equal(landed, 1);
      assert.equal(game.spells.delayed.pending, 0);
    });
  }

  it('withdraws delayed lists and releases a despawned unit when an area end hook throws', () => {
    const game = makeUnitGame(TEMPLATES, {
      areaTriggers: {
        ownerGone: () => {
          throw new Error('area hook');
        }
      },
      spells: {
        delayed: {
          activation: { kind: 'trigger' },
          release: () => [after(1, [run('landed', () => assert.fail('withdrawn list landed'))])]
        }
      }
    });

    const owner = game.units.spawn(game.id.hero, { side: 0 });

    game.spells.cast(owner, game.spellId.delayed);
    assert.throws(() => game.units.despawn(owner), /area hook/);
    assert.equal(game.spells.delayed.pending, 0);
    assert.equal(game.units.byId(owner.id), undefined);
    for (let i = 0; i < 4; i++) {
      game.clock.step();
    }
    game.spells.stepDelayed();
  });

  it('still cleans up owned effects when cancelling a cast throws', () => {
    const gone: number[] = [];

    const game = makeUnitGame(TEMPLATES, {
      areaTriggers: {
        ownerGone: (owner) => {
          gone.push(owner.id);
          return 1;
        }
      },
      spells: {
        delayed: { activation: { kind: 'trigger' }, release: () => [after(1, [])] },
        broken: {
          activation: { kind: 'trigger' },
          timeline: { windup: { seconds: 1 } },
          release: () => undefined,
          onEnd: () => {
            throw new Error('cast hook');
          }
        }
      }
    });

    const owner = game.units.spawn(game.id.hero, { side: 0 });

    game.spells.cast(owner, game.spellId.delayed);
    game.spells.cast(owner, game.spellId.broken);
    assert.throws(() => game.units.kill(owner), /cast hook/);
    assert.deepEqual(gone, [owner.id]);
    assert.equal(game.spells.delayed.pending, 0);
  });
});

describe('unit templates', () => {
  it('lay out base stats and class tags at load', () => {
    const units = defineUnits<UnitGame, keyof typeof TEMPLATES>(TEMPLATES, {
      stats: STATS,
      tags: UNIT_TAGS
    });

    const { id } = units;

    assert.equal(units.bases[id.hero]?.[STATS.id.maxHealth], 200);
    assert.equal(units.bases[id.grunt]?.[STATS.id.maxHealth], 100);
    assert.equal(units.bases[id.grunt]?.[STATS.id.speed], 4);
    assert.deepEqual(units.get(id.grunt).data, { souls: 1 });
    assert.equal(units.tagSets[id.boss]?.has(UNIT_TAGS.id.boss), true);
  });

  it('refuse unknown stats and tags, and unsound numbers', () => {
    const bad = (def: UnitDef<UnitGame>) => () =>
      defineUnits<UnitGame, 'bad'>({ bad: def }, { stats: STATS, tags: UNIT_TAGS });

    const forged: UnitDef<UnitGame> = {};

    Reflect.set(forged, 'stats', { luck: 3 });
    assert.throws(bad(forged), /Unit bad: there is no stat named luck/);
    assert.throws(bad({ stats: { speed: Number.NaN } }), /its speed must be a finite number/);
    Reflect.set(forged, 'stats', undefined);
    Reflect.set(forged, 'tags', ['dragon']);
    assert.throws(bad(forged), /there is no unit tag named dragon/);
  });
});

describe('spawning', () => {
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
      [false, true]
    );
    assert.equal(units.hasTag(grunt, 'horde'), true);
    assert.equal(units.byId(2), grunt);
    assert.equal(units.live(), 2);
    assert.equal(hero.loadout.size, 0);
    assert.deepEqual(grunt.ext, { marks: 0, made: `${game.id.grunt}/1` });
    assert.throws(() => units.spawn(game.id.grunt, { side: 1, id: 2 }), /entity id 2 is already a live unit/);

    for (const id of [Number.NaN, 2.5, -1]) {
      assert.throws(() => units.spawn(game.id.grunt, { side: 1, id }), /whole number from 0/);
    }

    assert.equal(units.spawn(game.id.grunt, { side: 1 }).id, 3);
    assert.deepEqual(game.log, ['spawned 1 alive>alive', 'spawned 2 alive>alive', 'spawned 3 alive>alive']);
  });
});

describe('variants', () => {
  it('spawn every unit of a variant with its bases, shared, over its template’s', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;
    const wave = units.variant(game.id.grunt, { maxHealth: 150, speed: 5 });

    const [a, b] = [
      units.spawn(game.id.grunt, { side: 1, variant: wave }),
      units.spawn(game.id.grunt, { side: 1, variant: wave })
    ];

    assert.deepEqual([a.health, b.health, units.statsOf(b).total(STATS.id.speed)], [150, 150, 5]);
    assert.equal(a.base, b.base);
    assert.equal(units.spawn(game.id.grunt, { side: 1 }).health, 100);
  });

  it('read their own bases as their base, so a template’s strength is no bonus', () => {
    const game = makeUnitGame(TEMPLATES);
    const brute = game.units.spawn(game.id.grunt, { side: 1, stats: { power: 40 } });
    const view = game.units.statsOf(brute);

    assert.deepEqual([view.base(STATS.id.power), view.total(STATS.id.power)], [40, 40]);
  });

  it('refuse a variant of another template, or one given with stats of the spawn’s own', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;
    const wave = units.variant(game.id.grunt, { maxHealth: 150 });

    assert.throws(() => units.spawn(game.id.elite, { side: 1, variant: wave }), /units.variant made for its template/);
    assert.throws(
      () => units.spawn(game.id.grunt, { side: 1, variant: wave, stats: { speed: 2 } }),
      /in place of its own stats/
    );
    const odd = {};

    Reflect.set(odd, 'luck', 1);
    assert.throws(() => units.variant(game.id.grunt, odd), /there is no stat named luck/);
  });
});

describe('sides, targeting and ids', () => {
  it('puts a unit on another side with an event, and is refused a side that is not whole', () => {
    const game = makeUnitGame(TEMPLATES);
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    assert.equal(game.units.setSide(grunt, 0), true);
    assert.equal(game.units.setSide(grunt, 0), false);
    assert.equal(grunt.side, 0);
    assert.deepEqual(game.log.slice(-1), ['side 1 0']);
    assert.throws(() => game.units.setSide(grunt, 0.5), /whole number/);
  });

  it('is untargetable while in a state that blocks targeting', () => {
    const game = makeUnitGame(TEMPLATES);
    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    assert.equal(game.units.isTargetable(grunt), true);
    game.auras.apply(grunt, auraId('veil'));
    assert.equal(game.units.isTargetable(grunt), false);
  });

  it('draws entity ids from a shared counter, a summon’s too', () => {
    const ids = createEntityIds(40);
    const game = makeUnitGame(TEMPLATES, { allocateId: ids.next });
    const hero = game.units.spawn(game.id.hero, { side: 0 });

    ids.next();
    assert.deepEqual([hero.id, game.units.spawn(game.id.grunt, { side: 1 }).id, ids.count()], [41, 43, 43]);
    assert.throws(() => createEntityIds(-1), /whole number/);
  });
});

describe('the lifecycle', () => {
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
      'despawned 1 alive>despawned'
    ]);
  });
});

describe('a move asked for during a move', () => {
  it('waits for the running one: a revive from a death’s onState follows the death, bound summons gone', () => {
    const game = makeUnitGame({ ...TEMPLATES, pet: {} });
    const { units, auras } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });
    const pet = units.spawn(game.id.pet, { side: 0, owner: hero, isBound: true });

    auras.apply(hero, auraId('lastStand'));
    game.log.length = 0;
    assert.equal(units.kill(hero), true);
    assert.deepEqual([hero.lifecycle, hero.health, pet.lifecycle], ['alive', 50, 'despawned']);
    assert.deepEqual(
      game.log.filter((line) => line.startsWith('changed')),
      ['changed 1 alive>dead', 'changed 1 dead>alive']
    );
  });
});

describe('moves asked for during a move, in order', () => {
  it('runs every one in turn, each checked then: a revive, then a corpse despawn a listener asked for', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });

    auras.apply(hero, auraId('lastStand'));
    game.on('changed', (event) => {
      if (event.to === 'dead' && event.unit !== undefined) {
        units.despawn(event.unit);
      }
    });
    assert.equal(units.kill(hero), true);
    assert.equal(hero.lifecycle, 'despawned');
  });

  it('drops the moves a throwing listener asked for, leaving none for the next move to run', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;
    const hero = units.spawn(game.id.hero, { side: 0 });
    let isBroken = true;

    game.on('changed', (event) => {
      if (isBroken && event.to === 'dead' && event.unit !== undefined) {
        units.despawn(event.unit);

        throw new Error('game bug');
      }
    });
    assert.throws(() => units.kill(hero), /game bug/);
    isBroken = false;
    assert.equal(units.revive(hero), true);
    assert.equal(hero.lifecycle, 'alive');
  });

  it('refuses a revive health that is not a finite number above 0', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });

    game.units.kill(hero);

    for (const health of [0, -5, Number.NaN]) {
      assert.throws(() => game.units.revive(hero, health), /finite health above 0/);
    }
  });

  it('sets up nothing more for a unit its own spawned listener despawned', () => {
    const game = makeUnitGame(TEMPLATES);

    game.on('spawned', (event) => {
      if (event.unit !== undefined) {
        game.units.despawn(event.unit);
      }
    });

    const grunt = game.units.spawn(game.id.grunt, { side: 1 });

    assert.equal(grunt.lifecycle, 'despawned');
    assert.equal(grunt.scriptSlot, -1);
  });
});

describe('bearer states on the lifecycle', () => {
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

  it('takes the auras a unit put on others bound to it off them as it dies or despawns', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras } = game;
    const [hero, warlock, imp] = [0, 1, 2].map(() => units.spawn(game.id.grunt, { side: 1 }));
    const brand = auraId('brand');

    if (hero === undefined || warlock === undefined || imp === undefined) {
      assert.fail('no units');
    }

    auras.apply(hero, { aura: brand, source: warlock.id });
    auras.apply(imp, { aura: brand, source: hero.id });
    auras.apply(hero, { aura: auraId('haste'), source: warlock.id });
    units.kill(warlock);
    assert.deepEqual([auras.has(hero, brand), auras.has(hero, auraId('haste'))], [false, true]);
    units.despawn(hero);
    assert.equal(auras.has(imp, brand), false);
  });

  it('gives a despawned unit’s every aura back to the pool, so units coming and going leak none', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras } = game;

    const comeAndGo = (): void => {
      const grunt = units.spawn(game.id.grunt, { side: 1 });

      auras.apply(grunt, auraId('haste'));
      auras.apply(grunt, auraId('vigour'));
      units.despawn(grunt);
      assert.deepEqual([auras.list(grunt).length, auras.pool.live], [0, 0]);
    };

    // Past the pool's minimum of waiting free slots, it reuses them.
    for (let i = 0; i <= POOL_MIN_FREE; i++) {
      comeAndGo();
    }

    const { created } = auras.pool;

    for (let i = 0; i < 3; i++) {
      comeAndGo();
    }

    assert.equal(auras.pool.created, created);
  });
});

describe('a despawn whose hook throws', () => {
  it('still forgets the unit and releases its auras, when an aura hearing it or a listener throws', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units, auras } = game;
    const [hearing, heard] = [units.spawn(game.id.grunt, { side: 1 }), units.spawn(game.id.grunt, { side: 1 })];

    auras.apply(hearing, auraId('mark'));
    HEARD.push = () => {
      throw new Error('onState');
    };

    try {
      assert.throws(() => units.despawn(hearing), /onState/);
    } finally {
      Reflect.deleteProperty(HEARD, 'push');
    }

    game.on('despawned', () => {
      throw new Error('listener');
    });
    auras.apply(heard, auraId('haste'));
    assert.throws(() => units.despawn(heard), /listener/);
    assert.deepEqual([hearing.lifecycle, heard.lifecycle], ['despawned', 'despawned']);
    assert.deepEqual(
      [units.byId(hearing.id), units.byId(heard.id), units.live(), auras.pool.live],
      [undefined, undefined, 0, 0]
    );
  });
});

describe('derived states', () => {
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
