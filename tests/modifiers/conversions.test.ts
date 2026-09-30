import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createModifierSystem, defineSources, defineStats, linear, plus, rating } from '../../src/modifiers/index.ts';

describe('rating conversions', () => {
  it('add curve(rating) to the target stat after its additions and before its multipliers', () => {
    const stats = defineStats({
      level: { base: 1, kind: 'flat' },
      hitRating: { base: 0, kind: 'flat', converts: { to: 'hitChance', curve: rating(10) } },
      hitChance: { base: 0.05, kind: 'flat', max: 1 },
    });

    const sources = defineSources(['gear']);
    const system = createModifierSystem({ stats, sources });
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.gear, [system.compile([plus('hitRating', 150), plus('hitChance', 0.01)])]);

    assert.deepEqual(
      stats.derivations[stats.id.hitChance]?.map((d) => [d.kind, d.from]),
      [['converts', 1]],
    );
    assert.equal(system.resolve(sheet, stats.id.hitChance), 0.21);
  });

  it('read the bearer through their curve parameters: rating per 1% by level', () => {
    const stats = defineStats({
      level: { base: 1, kind: 'flat' },
      hitRating: {
        base: 0,
        kind: 'flat',
        converts: {
          to: 'hitChance',
          curve: rating({
            kind: 'lookup',
            stat: 'level',
            from: 'caster',
            points: [
              [1, 10],
              [60, 15.8],
            ],
          }),
        },
      },
      hitChance: { base: 0, kind: 'flat' },
    });

    const sources = defineSources(['gear']);
    const system = createModifierSystem({ stats, sources });
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.gear, [system.compile([plus('hitRating', 158), plus('level', 59)])]);

    assert.equal(system.resolve(sheet, stats.id.hitChance), 0.1);
  });

  it('refuse a conversion curve that reads a target, since a conversion has none', () => {
    assert.throws(
      () =>
        defineStats({
          level: { base: 1, kind: 'flat' },
          rating: {
            base: 0,
            kind: 'flat',
            converts: { to: 'level', curve: linear({ base: 1, add: [{ stat: 'level', coef: 1, from: 'target' }] }) },
          },
        }),
      /no target here/,
    );
  });
});

describe('definitions stay data', () => {
  it('are frozen by the table and never written by a fold', () => {
    const damage = { base: 1, kind: 'multiplier' } as const;
    const stats = defineStats({ damage, armor: { base: 0, kind: 'flat' } });
    const sources = defineSources(['gear']);
    const system = createModifierSystem({ stats, sources });
    const modifiers = [plus('armor', 3)];
    const list = system.compile(modifiers);
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.gear, [list]);
    system.resolve(sheet, stats.id.armor);

    assert.equal(Object.isFrozen(damage), true);
    assert.equal(Object.isFrozen(list.modifiers[0]), true);
    assert.deepEqual(modifiers, [{ stat: 'armor', op: 'add', value: 3 }]);
  });
});
