import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineValues, type ValueRead } from '../../src/conditions/index.ts';
import {
  byLevel,
  compileScaled,
  createModifierSystem,
  curveOf,
  defineSources,
  defineStats,
  FrozenStats,
  hostValue,
  linear,
  mul,
  perStat,
  plus,
  ranks,
  scaled,
  type StatDef
} from '../../src/modifiers/index.ts';

/** A bearer with a health share, for the value kinds. */
interface Host {
  readonly share: number;
}

/** A game whose names are open strings, so a test can hand the compiler a name the game never declared. */
const loose = () => {
  const table: Readonly<Record<string, StatDef>> = {
    damage: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat' },
    level: { base: 1, kind: 'flat' }
  };

  const names: readonly string[] = ['base', 'auras'];
  const stats = defineStats(table);
  const sources = defineSources(names);
  const kinds: Readonly<Record<string, ValueRead<Host>>> = { missing: (host, max) => 1 + max * (1 - host.share) };
  const values = defineValues(kinds);

  return { stats, sources, system: createModifierSystem({ stats, sources, values }) };
};

describe('modifier registration', () => {
  it('refuses a stat, a value kind or a cap the game did not declare, or a NaN', () => {
    const { system } = loose();

    assert.throws(
      () => system.compile([plus('speed', 1)], { what: 'haste' }),
      /haste, modifier 0: there is no stat named speed/
    );
    assert.throws(() => system.compile([mul('damage', hostValue('fury', 1))]), /no value kind named fury/);
    assert.throws(() => system.compile([mul('damage', hostValue('missing', Number.NaN))]), /arg must be a number/);
    assert.throws(
      () => system.compile([plus('armor', perStat('level', 1, { cap: Number.NaN }))]),
      /cap must be a number/
    );
  });

  it('refuses linear stacking off a mul, a scope that is no id, and a gate that is no id', () => {
    const { system } = loose();

    assert.throws(() => system.compile([plus('armor', 1, { stacking: 'linear' })]), /linear stacking applies to a mul/);
    assert.throws(() => system.compile([mul('damage', 1.1, { scope: -1 })]), /scope must be a game scope id/);
    assert.throws(() => system.compile([mul('damage', 1.1, { scope: 1.5 })]), /scope must be a game scope id/);
    assert.throws(() => system.compile([mul('damage', 1.1)], { gate: -1 }), /gate must be a non-negative integer/);
    assert.throws(() => system.compile([mul('damage', 1.1)], { gate: 0.5 }), /gate must be a non-negative integer/);
  });

  it('refuses a sheet given bases of the wrong length', () => {
    const { system } = loose();
    const sheet = system.createSheet();

    assert.throws(() => {
      system.setBases(sheet, [1, 0]);
    }, /one number per stat \(3\); got 2/);
  });

  it('refuses more sources than a fold mask can hold', () => {
    const names = Array.from({ length: 33 }, (_unused, i) => `source${i}`);

    assert.throws(() => defineSources(names), /at most 32 modifier sources; it declared 33/);
    assert.equal(defineSources(names.slice(0, 32)).size, 32);
  });
});

describe('scaled value registration', () => {
  it('refuses an empty rank list, and a base or ratio that is not finite', () => {
    const { stats } = loose();

    assert.throws(() => ranks(), /at least one value/);
    assert.throws(() => compileScaled(stats, scaled(Infinity)), /every base and ratio must be a finite number/);
    assert.throws(
      () => compileScaled(stats, scaled(1, curveOf(linear(1), Number.NaN, { stat: 'level' })), { what: 'blast' }),
      /blast: every base and ratio must be a finite number/
    );
  });

  it('refuses a curve parameter reading the target where there is none', () => {
    const { stats } = loose();
    const value = scaled(1, curveOf(linear(byLevel([[1, 1]], { from: 'target' })), 1, { stat: 'level' }));

    assert.throws(
      () => compileScaled(stats, value, { allowsTarget: false, what: 'a conversion' }),
      /a conversion: a lookup reads the target's level, but there is no target here/
    );
    assert.equal(compileScaled(stats, value).hasTarget, true);
  });
});

/** Three typed stat ids (0, 1 and 2), and one past them (3). */
const IDS = defineStats({
  damage: { base: 1, kind: 'multiplier' },
  armor: { base: 0, kind: 'flat' },
  level: { base: 1, kind: 'flat' },
  past: { base: 0, kind: 'flat' }
}).id;

describe('frozen stats', () => {
  it('hold the totals and bases they took, and throw for a stat not taken or past their size', () => {
    const view = { total: (stat: number) => stat * 10, base: (stat: number) => stat };
    const frozen = new FrozenStats(3);

    assert.equal(frozen.size, 3);
    assert.equal(frozen.take(view, [IDS.damage, IDS.level]), frozen);
    assert.deepEqual([frozen.total(IDS.level), frozen.base(IDS.level), frozen.total(IDS.damage)], [20, 2, 0]);
    assert.throws(() => frozen.total(IDS.armor), /Stat 1 was not frozen/);
    assert.throws(() => frozen.base(IDS.armor), /Stat 1 was not frozen/);
    assert.throws(() => frozen.take(view, [IDS.past]), /Stat 3 is past the 3 stats/);
  });

  it('forget what they took before when taking again', () => {
    const view = { total: (stat: number) => stat * 10, base: () => 0 };
    const frozen = new FrozenStats(2).take(view, [IDS.damage]).take(view, [IDS.armor]);

    assert.equal(frozen.total(IDS.armor), 10);
    assert.throws(() => frozen.total(IDS.damage), /Stat 0 was not frozen/);
  });
});
