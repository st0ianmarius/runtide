import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Vec2 } from '../../src/math/index.ts';
import { escapeReport } from '../../src/procs/index.ts';
import { castSpell, NO_CAST } from '../../src/spells/index.ts';
import { despawn, despawnSummons, summon, type UnitDef } from '../../src/units/index.ts';
import { createMemoryWorld } from '../../src/world/index.ts';
import { makeUnitGame, STATS, type UnitGame } from '../helpers/unit-game.ts';

/** A caster, the adds it raises and a pet. */
const TEMPLATES = {
  caster: { stats: { power: 20 } },
  add: { stats: { maxHealth: 30 } },
  pet: {}
} satisfies Record<string, UnitDef<UnitGame>>;

/** A game with one caster, of side 1. */
const summoning = (options: Parameters<typeof makeUnitGame<keyof typeof TEMPLATES, 'raise'>>[1] = {}) => {
  const game = makeUnitGame(TEMPLATES, {
    spells: {
      raise: {
        activation: { kind: 'trigger' },
        release: () => [summon<UnitGame>('add', { count: 2 })]
      }
    },
    ...options
  });

  const caster = game.units.spawn(game.id.caster, { side: 1 });

  return { ...game, caster };
};

describe('summoning', () => {
  it('spawns units owned by the list’s self, on its side, at a point the spawned event carries', () => {
    const { procs, units, caster, log } = summoning();

    const outcome = procs.apply(summon<UnitGame>('add', { count: 2, at: { x: 3, z: 4 } }), {
      self: caster
    });

    assert.deepEqual([outcome.status, outcome.amount], ['landed', 2]);

    const adds = units.summonsOf(caster);

    assert.deepEqual(
      adds.map((add) => [add.owner, add.side, add.health]),
      [
        [caster, 1, 30],
        [caster, 1, 30]
      ]
    );
    assert.equal(log.filter((line) => line === 'at 3,4').length, 2);
    assert.equal(procs.apply(summon<UnitGame>('add', { countOf: () => 0 }), { self: caster }).status, 'skipped');
  });

  it('spawns them on another side when the proc names one, still owned and bound', () => {
    const { procs, units, caster } = summoning();

    procs.apply(summon<UnitGame>('add', { side: 0 }), { self: caster });

    const [turned] = units.summonsOf(caster);

    assert.deepEqual([turned?.owner, turned?.side, turned?.isBound], [caster, 0, true]);
  });

  it('snapshots stats over the template’s, and inherited shares of the owner’s totals', () => {
    const { procs, units, caster } = summoning();

    procs.apply(summon<UnitGame>('pet', { stats: { speed: 9 }, inherit: { power: 0.5 } }), {
      self: caster
    });

    const [pet] = units.summonsOf(caster);
    const stats = pet === undefined ? undefined : units.statsOf(pet);

    assert.equal(stats?.total(STATS.id.power), 10);
    assert.equal(stats?.total(STATS.id.speed), 9);
  });

  it('credits a summon’s deeds to its owner, up the chain', () => {
    const { procs, units, caster } = summoning();

    procs.apply(summon<UnitGame>('pet'), { self: caster });

    const [pet] = units.summonsOf(caster);

    assert.ok(pet !== undefined);
    procs.apply(summon<UnitGame>('add'), { self: pet });

    const [add] = units.summonsOf(pet);

    assert.ok(add !== undefined);
    assert.equal(units.creditOf(add), caster.id);
    assert.equal(units.creditOf(caster), caster.id);
  });

  it('despawns bound summons with their owner’s death or despawn, and keeps unbound ones', () => {
    const { procs, units, caster, log } = summoning();

    procs.apply(summon<UnitGame>('add'), { self: caster });
    procs.apply(summon<UnitGame>('pet', { isBound: false }), { self: caster });

    const [add, pet] = units.summonsOf(caster);

    units.kill(caster);
    assert.equal(add?.lifecycle, 'despawned');
    assert.equal(pet?.lifecycle, 'alive');
    assert.ok(log.includes('reason owner'));
    assert.deepEqual(units.summonsOf(caster), [pet]);
  });

  it('drops a summon from its owner’s list as it dies', () => {
    const { procs, units, caster } = summoning();

    procs.apply(summon<UnitGame>('add', { count: 2 }), { self: caster });

    const [first, second] = units.summonsOf(caster);

    if (first !== undefined) {
      units.kill(first);
    }

    assert.deepEqual(units.summonsOf(caster), [second]);
  });

  it('rejoins its owner’s list as it is revived, while its owner lives', () => {
    const { procs, units, caster } = summoning();

    procs.apply(summon<UnitGame>('add', { count: 2 }), { self: caster });

    const [first, second] = units.summonsOf(caster);

    if (first !== undefined) {
      units.kill(first);
      units.revive(first);
    }

    assert.deepEqual(units.summonsOf(caster), [second, first]);
  });

  it('keeps an owner to its limit of a template: replacing its oldest, or refused', () => {
    const { procs, units, caster, log } = summoning();

    procs.apply(summon<UnitGame>('add', { count: 2, limit: { perOwner: 2 } }), { self: caster });

    const [oldest, kept] = units.summonsOf(caster);

    const replaced = procs.apply(summon<UnitGame>('add', { limit: { perOwner: 2 } }), {
      self: caster
    });

    assert.deepEqual([replaced.amount, oldest?.lifecycle, units.summonsOf(caster).length], [1, 'despawned', 2]);
    assert.equal(units.summonsOf(caster)[0], kept);
    assert.ok(log.includes('reason replaced'));

    const refused = procs.apply(summon<UnitGame>('add', { count: 3, limit: { perOwner: 2, replace: 'refuse' } }), {
      self: caster
    });

    assert.deepEqual([refused.status, units.summonsOf(caster).length], ['skipped', 2]);
    procs.apply(summon<UnitGame>('pet', { limit: { perOwner: 1, replace: 'refuse' } }), {
      self: caster
    });
    assert.equal(units.summonsOf(caster).length, 3);
    assert.throws(
      () => procs.prepare([summon<UnitGame>('pet', { limit: { perOwner: 0 } })], 'Test'),
      /limit is a whole/
    );
  });

  it('despawns a unit with a reason, and an owner’s summons of a template', () => {
    const { procs, units, caster, log } = summoning();

    procs.apply(summon<UnitGame>('add', { count: 2 }), { self: caster });
    procs.apply(summon<UnitGame>('pet'), { self: caster });
    assert.equal(procs.apply(despawnSummons<UnitGame>({ unit: 'add', reason: 'phase' }), { self: caster }).amount, 2);
    assert.equal(log.filter((line) => line === 'reason phase').length, 2);

    const [pet] = units.summonsOf(caster);

    assert.ok(pet !== undefined);
    assert.equal(procs.apply(despawn<UnitGame>({ reason: 'expired' }), { self: caster, target: pet }).status, 'landed');
    assert.equal(procs.apply(despawn<UnitGame>(), { self: caster, target: pet }).status, 'skipped');
    assert.ok(log.includes('reason expired'));
    assert.equal(procs.apply(despawnSummons<UnitGame>(), { self: caster }).status, 'skipped');
  });

  it('keeps the summoning cast live while its summons live', () => {
    const { procs, spells, units, caster, spellId } = summoning();

    procs.apply(castSpell<UnitGame>('raise'), { self: caster });

    const [first, second] = units.summonsOf(caster);
    const cast = first?.cast ?? NO_CAST;

    assert.notEqual(cast, NO_CAST);
    assert.equal(spells.get(cast)?.spell, spellId.raise);

    if (first !== undefined && second !== undefined) {
      units.kill(first);
      assert.notEqual(spells.get(cast), undefined);
      units.despawn(second);
    }

    assert.equal(spells.get(cast), undefined);
  });

  it('places each where its atOf says: a point the game picks around the owner in its world', () => {
    const world = createMemoryWorld<object>({
      bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 }
    });

    const { procs, units, caster, log } = summoning();

    world.add(caster, { id: caster.id, at: { x: 10, z: 10 }, radius: 0.5, side: 1 });

    const around = summon<UnitGame>('add', {
      atOf: (ctx) => {
        const centre = world.positionOf(ctx.self, { x: 0, z: 0 });
        const random = ctx.random();

        const sample = (): Vec2 => {
          const heading = random() * 2 * Math.PI;
          const distance = 2 + random();

          return {
            x: centre.x + Math.sin(heading) * distance,
            z: centre.z + Math.cos(heading) * distance
          };
        };

        return world.pickPoint({ attempts: 8, sample });
      }
    });

    procs.apply(around, { self: caster });

    const point =
      log
        .find((line) => line.startsWith('at '))
        ?.slice(3)
        .split(',')
        .map(Number) ?? [];

    const distance = Math.hypot((point[0] ?? 0) - 10, (point[1] ?? 0) - 10);

    assert.equal(units.summonsOf(caster).length, 1);
    assert.ok(distance >= 2 && distance <= 3, `${distance}`);
    assert.throws(() => summoning().procs.prepare([summon<UnitGame>('add', { count: 1.5 })], 'Test'), /whole number/);
  });
});

describe('the escape report over a unit game', () => {
  it('counts the unit and AI proc kinds as the framework’s own, not as hatches', () => {
    const { procs, spells, damage, units, ai } = summoning();

    assert.deepEqual(escapeReport({ procs, spells, damage }).procKinds, [
      'revive',
      'summon',
      'despawn',
      'despawnSummons',
      'setTimer',
      'cancelTimer',
      'setFocus'
    ]);
    assert.deepEqual(escapeReport({ procs, spells, damage, units, ai }).procKinds, []);
  });
});
