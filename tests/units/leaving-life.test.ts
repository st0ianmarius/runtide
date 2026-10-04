import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summon, type UnitDef } from '../../src/units/index.ts';
import { auraId, HEARD, makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero and a pet. */
const TEMPLATES = { hero: {}, pet: {} } satisfies Record<string, UnitDef<UnitGame>>;

/** Whether an error is a `SuppressedError` whose first error and later one carry these messages. */
const suppressed = (first: string, later: string) => (error: unknown) =>
  error instanceof Error &&
  error.name === 'SuppressedError' &&
  'error' in error &&
  'suppressed' in error &&
  error.error instanceof Error &&
  error.error.message === first &&
  error.suppressed instanceof Error &&
  error.suppressed.message === later;

describe('what a unit owns as it leaves life', () => {
  for (const to of ['dead', 'despawned'] as const) {
    it(`ends its areas before its source-bound auras come off, on ${to}`, () => {
      const late: { other?: UnitGame['bearer']; game?: ReturnType<typeof makeUnitGame<keyof typeof TEMPLATES>> } = {};

      const game = makeUnitGame(TEMPLATES, {
        areaTriggers: {
          ownerGone: (owner) => {
            if (late.other !== undefined) {
              late.game?.auras.apply(late.other, { aura: auraId('brand'), source: owner.id });
            }

            return 1;
          }
        }
      });

      late.game = game;

      const hero = game.units.spawn(game.id.hero, { side: 0 });
      const other = game.units.spawn(game.id.pet, { side: 1 });

      late.other = other;
      game.auras.apply(other, { aura: auraId('brand'), source: hero.id });

      if (to === 'dead') {
        game.units.kill(hero);
      } else {
        game.units.despawn(hero);
      }

      assert.equal(game.auras.has(other, auraId('brand')), false);
    });
  }

  it('keeps an unowned death burst its death schedules, and withdraws one the dying unit owns', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const pet = game.units.spawn(game.id.pet, { side: 1 });

    HEARD.length = 0;
    game.auras.apply(hero, auraId('burst'));
    game.auras.apply(pet, auraId('ownedBurst'));
    game.units.kill(hero);
    game.units.kill(pet);
    assert.equal(game.spells.delayed.pending, 1);
    game.clock.step();
    game.spells.stepDelayed();
    assert.deepEqual(HEARD, [`burst ${hero.id}`]);
  });

  it('surfaces the first error of its cleanup, the later ones suppressed behind it', () => {
    const game = makeUnitGame(TEMPLATES, {
      areaTriggers: {
        ownerGone: () => {
          throw new Error('area hook');
        }
      },
      spells: {
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

    const hero = game.units.spawn(game.id.hero, { side: 0 });

    game.spells.cast(hero, game.spellId.broken);
    assert.throws(() => game.units.kill(hero), suppressed('cast hook', 'area hook'));
    assert.equal(hero.lifecycle, 'dead');
  });

  it('enters its dead state when a cast hook throws as its death cancels the cast', () => {
    const game = makeUnitGame(TEMPLATES, {
      spells: {
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

    const hero = game.units.spawn(game.id.hero, { side: 0 });

    HEARD.length = 0;
    game.auras.apply(hero, auraId('mark'));
    game.spells.cast(hero, game.spellId.broken);
    assert.throws(() => game.units.kill(hero), /cast hook/);
    assert.deepEqual(HEARD, [`dead ${hero.id}`]);
    assert.equal(game.auras.has(hero, auraId('mark')), false);
    assert.equal(game.log.includes(`changed ${hero.id} alive>dead`), true);
  });

  it('raises its change and runs the revive its death asked for when its cleanup throws, then surfaces the error', () => {
    const game = makeUnitGame(TEMPLATES, {
      areaTriggers: {
        ownerGone: () => {
          throw new Error('area hook');
        }
      }
    });

    const hero = game.units.spawn(game.id.hero, { side: 0 });

    game.auras.apply(hero, auraId('lastStand'));
    assert.throws(() => game.units.kill(hero), /area hook/);
    assert.equal(hero.lifecycle, 'alive');
    assert.equal(hero.health, 50);

    assert.deepEqual(
      game.log.filter((line) => line.startsWith('changed')),
      [`changed ${hero.id} alive>dead`, `changed ${hero.id} dead>alive`]
    );
  });

  it('despawns every bound summon when their despawns throw, surfacing the first', () => {
    const game = makeUnitGame(TEMPLATES);
    const owner = game.units.spawn(game.id.hero, { side: 0 });

    game.procs.apply(summon<UnitGame>('pet', { count: 2 }), { self: owner });

    const pets = game.units.summonsOf(owner).slice();

    game.on('despawned', (event) => {
      const index = event.unit === undefined ? -1 : pets.indexOf(event.unit);

      if (index >= 0) {
        throw new Error(`pet ${index}`);
      }
    });

    assert.throws(() => game.units.despawn(owner), suppressed('pet 0', 'pet 1'));
    assert.deepEqual([owner.lifecycle, ...pets.map((pet) => pet.lifecycle)], ['despawned', 'despawned', 'despawned']);
  });
});

describe('a bound spawn whose owner is gone', () => {
  it('is despawned at once by spawn (reason owner), and refused by trySpawn', () => {
    const game = makeUnitGame(TEMPLATES);
    const hero = game.units.spawn(game.id.hero, { side: 0 });
    const made: UnitGame['bearer'][] = [];

    game.on('changed', (event) => {
      if (event.unit === hero && event.to === 'dead') {
        made.push(game.units.spawn(game.id.pet, { side: 0, owner: hero, isBound: true }));
        made.push(game.units.spawn(game.id.pet, { side: 0, owner: hero }));
      }
    });

    game.units.kill(hero);

    const [bound, unbound] = made;

    assert.ok(bound !== undefined && unbound !== undefined);
    assert.deepEqual([bound.lifecycle, unbound.lifecycle], ['despawned', 'alive']);
    assert.deepEqual(game.units.summonsOf(hero), [unbound]);
    assert.ok(game.log.includes('reason owner'));

    const live = game.units.live();

    assert.equal(game.units.trySpawn(game.id.pet, { side: 0, owner: hero, isBound: true }), undefined);
    assert.equal(game.units.live(), live);
  });
});

describe('a revived summon', () => {
  it('rejoins its owner only with room under the limit it was summoned with, else lives on as an orphan', () => {
    const game = makeUnitGame(TEMPLATES);
    const owner = game.units.spawn(game.id.hero, { side: 0 });
    const proc = summon<UnitGame>('pet', { limit: { perOwner: 1, replace: 'refuse' } });

    game.procs.apply(proc, { self: owner });

    const [first] = game.units.summonsOf(owner);

    assert.ok(first !== undefined);
    game.units.kill(first);
    game.procs.apply(proc, { self: owner });

    const [second] = game.units.summonsOf(owner);

    assert.ok(second !== undefined && second !== first);
    assert.equal(game.units.revive(first), true);
    assert.deepEqual(game.units.summonsOf(owner), [second]);
    assert.deepEqual([first.owner, game.units.creditOf(first)], [undefined, owner.id]);
    game.units.despawn(owner);
    assert.deepEqual([first.lifecycle, second.lifecycle], ['alive', 'despawned']);
  });

  it('answers true for a revive queued behind a despawn, which the despawn then refuses', () => {
    const game = makeUnitGame(TEMPLATES);
    const pet = game.units.spawn(game.id.pet, { side: 0 });
    const answers: boolean[] = [];

    game.on('changed', (event) => {
      if (event.unit === pet && event.to === 'dead') {
        answers.push(game.units.despawn(pet), game.units.revive(pet));
      }
    });

    game.units.kill(pet);
    assert.deepEqual([answers, pet.lifecycle], [[true, true], 'despawned']);
  });
});
