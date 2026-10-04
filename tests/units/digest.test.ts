import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DIGEST_START } from '../../src/core/index.ts';
import type { Unit } from '../../src/units/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

/** The test templates: a hero and a grunt. */
const TEMPLATES = { hero: { stats: { maxHealth: 200 } }, grunt: {} };

/** The ids of the first `count` units of a list. */
const idsOf = (out: readonly Unit<UnitGame>[], count: number): number[] => out.slice(0, count).map((unit) => unit.id);

describe('units.list', () => {
  it('fills a reused array with every unit not despawned, dead ones too, in ascending id order', () => {
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;
    const a = units.spawn(game.id.hero, { side: 0 });
    const b = units.spawn(game.id.grunt, { side: 1 });
    const c = units.spawn(game.id.grunt, { side: 1 });
    const out: Unit<UnitGame>[] = [a, a, a, a, a, a];

    units.kill(b);
    units.despawn(c);
    assert.equal(units.list(out), 2);
    assert.deepEqual(idsOf(out, out.length), [a.id, b.id], 'the array is emptied first');

    // A spawn naming ids of its own, lower and between, lands where its id belongs.
    units.spawn(game.id.grunt, { side: 1, id: 0 });
    units.spawn(game.id.grunt, { side: 1, id: 10 });
    units.spawn(game.id.grunt, { side: 1, id: 7 });
    units.spawn(game.id.grunt, { side: 1 });
    assert.equal(units.list(out), 6);
    assert.deepEqual(idsOf(out, 6), [0, 1, 2, 7, 10, 11]);
    units.despawn(units.byId(7) ?? assert.fail('no unit 7'));
    units.despawn(units.byId(0) ?? assert.fail('no unit 0'));
    assert.deepEqual(idsOf(out, units.list(out)), [1, 2, 10, 11]);
  });
});

describe('units.digest', () => {
  /** A game with units spawned under the given ids, in the given order, each a grunt of side 1. */
  const spawned = (ids: readonly number[]) => {
    const game = makeUnitGame(TEMPLATES);

    for (const id of ids) {
      game.units.spawn(game.id.grunt, { side: 1, id });
    }

    return game;
  };

  it('is the same for the same units whatever order they spawned in', () => {
    assert.equal(spawned([5, 3, 9]).units.digest(DIGEST_START), spawned([3, 9, 5]).units.digest(DIGEST_START));
    assert.notEqual(spawned([5, 3, 9]).units.digest(DIGEST_START), spawned([5, 3]).units.digest(DIGEST_START));
    assert.notEqual(spawned([1]).units.digest(DIGEST_START), DIGEST_START);
  });

  it('moves with each field it folds: side, lifecycle, health, owner, template and variant', () => {
    const digests = new Set<number>();
    const game = makeUnitGame(TEMPLATES);
    const { units } = game;

    const note = (): void => {
      const before = digests.size;

      digests.add(units.digest(DIGEST_START));
      assert.equal(digests.size, before + 1, 'each change moves the digest');
    };

    const hero = units.spawn(game.id.hero, { side: 0 });

    note();

    const grunt = units.spawn(game.id.grunt, { side: 1 });

    note();
    units.setSide(grunt, 2);
    note();
    game.damage.setHealth(hero, 150);
    note();
    units.kill(grunt);
    note();
    units.spawn(game.id.grunt, { side: 1, owner: hero });
    note();

    const other = makeUnitGame(TEMPLATES);

    other.units.spawn(other.id.grunt, { side: 1 });

    const plain = other.units.digest(DIGEST_START);
    const varied = makeUnitGame(TEMPLATES);

    varied.units.spawn(varied.id.grunt, { side: 1, variant: varied.units.variant(varied.id.grunt, {}) });
    assert.notEqual(varied.units.digest(DIGEST_START), plain, 'a variant shows, even one with the same bases');

    const hero1 = makeUnitGame(TEMPLATES);

    hero1.units.spawn(hero1.id.hero, { side: 1, stats: { maxHealth: 1 } });

    const grunt1 = makeUnitGame(TEMPLATES);

    grunt1.units.spawn(grunt1.id.grunt, { side: 1, stats: { maxHealth: 1 } });
    assert.notEqual(hero1.units.digest(DIGEST_START), grunt1.units.digest(DIGEST_START), 'the template shows');
  });

  it('goes on from the hash it is handed', () => {
    const game = spawned([1, 2]);

    assert.notEqual(game.units.digest(DIGEST_START), game.units.digest(1));
  });
});
