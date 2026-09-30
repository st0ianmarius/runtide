import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  add,
  customCurve,
  defineCurves,
  defineStats,
  linear,
  scaled,
  type StatDef
} from '../../src/modifiers/index.ts';
import { HASTE } from '../helpers/curves.ts';

describe('the stat table', () => {
  it('gives dense ids in key order and typed columns for the fold', () => {
    const stats = defineStats({
      attackDamage: { base: 60, kind: 'flat' },
      damage: { base: 1, kind: 'multiplier' },
      armorPen: { base: 0, kind: 'multiplier', neutral: 0 },
      critChance: { base: 0, kind: 'flat', min: 0, max: 1 }
    });

    assert.deepEqual(stats.id, { attackDamage: 0, damage: 1, armorPen: 2, critChance: 3 });
    assert.deepEqual([...stats.columns.base], [60, 1, 0, 0]);
    assert.deepEqual([...stats.columns.neutral], [0, 1, 0, 0]);
    assert.deepEqual([...stats.columns.isMultiplier], [0, 1, 1, 0]);
    assert.deepEqual([...stats.columns.min], [-Infinity, -Infinity, -Infinity, 0]);
    assert.deepEqual([...stats.columns.max], [Infinity, Infinity, Infinity, 1]);
  });

  it('refuses a clamp upside down, an unknown kind, a NaN, and links to missing stats or to itself', () => {
    assert.throws(() => defineStats({ a: { base: 0, kind: 'flat', min: 2, max: 1 } }), /min 2 is above max 1/);
    assert.throws(() => defineStats({ a: { base: Number.NaN, kind: 'flat' } }), /must be numbers/);
    assert.throws(() => {
      const table: Readonly<Record<string, StatDef>> = {
        a: { base: 0, kind: 'flat', derives: { from: 'b', per: 1 } }
      };

      return defineStats(table);
    }, /no stat named b/);
    assert.throws(() => defineStats({ a: { base: 0, kind: 'flat', derives: { from: 'a', per: 1 } } }), /names itself/);
    assert.throws(() => defineStats({ a: { base: 0, kind: 'flat', curve: 'soft' } }), /no curve named soft/);
  });

  it('refuses derived terms that loop back to their own stat', () => {
    assert.throws(
      () =>
        defineStats({
          a: {
            base: 0,
            kind: 'flat',
            derives: { from: 'b', per: 1 },
            converts: { to: 'c', curve: linear(1) }
          },
          b: { base: 0, kind: 'flat', derives: { from: 'c', per: 1 } },
          c: { base: 0, kind: 'flat' }
        }),
      /derives from itself/
    );
  });

  it('refuses a conversion whose curve parameters read the stat it converts into', () => {
    const curves = defineCurves({ dr: customCurve((x, { k }) => x / (x + k), { k: scaled(1, add('armor', 1)) }) });

    assert.throws(
      () =>
        defineStats(
          {
            rating: { base: 10, kind: 'flat', converts: { to: 'armor', curve: 'dr' } },
            armor: { base: 0, kind: 'flat' }
          },
          { curves }
        ),
      /derives from itself/
    );
  });

  it('names curves in the game’s curve table, which is empty by default', () => {
    const curves = defineCurves({ haste: HASTE, soft: (x) => x / 2 });

    const stats = defineStats({ abilityHaste: { base: 0, kind: 'flat', curve: 'haste' } }, { curves });

    assert.deepEqual(curves.id, { haste: 0, soft: 1 });
    assert.equal(stats.curves, curves);
    assert.deepEqual(defineStats({ a: { base: 0, kind: 'flat' } }).curves.names, []);
    assert.throws(() => defineStats({ a: { base: 0, kind: 'flat', curve: 'haste' } }), /no curve named haste/);
  });
});
