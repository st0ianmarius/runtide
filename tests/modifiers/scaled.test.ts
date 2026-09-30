import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  add,
  amp,
  compileScaled,
  curveOf,
  defineStats,
  evaluateScaled,
  explainScaled,
  finishScaled,
  haste,
  hyperbolic,
  ranks,
  scaled,
  shareOf,
  snapshotScaled,
  type StatTable,
  type StatView
} from '../../src/modifiers/index.ts';

const STATS = defineStats({
  attackDamage: { base: 60, kind: 'flat' },
  abilityPower: { base: 0, kind: 'flat' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
  maxHealth: { base: 600, kind: 'flat' },
  level: { base: 1, kind: 'flat' },
  damage: { base: 1, kind: 'multiplier' },
  critDamage: { base: 1.75, kind: 'multiplier' },
  armorPen: { base: 0, kind: 'multiplier', neutral: 0 }
});

const { id } = STATS;

/** A unit's folded stats, by name, read live from `totals`; unnamed stats read their base. */
const unit = (totals: Readonly<Record<string, number>>): StatView => ({
  total: (stat) => totals[STATS.names[stat] ?? ''] ?? STATS.columns.base[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0
});

describe('scaled values', () => {
  it('evaluate a LoL-style ratio: base per rank + 120% AD + 50% AP + 8% of the target’s maximum health', () => {
    const damage = compileScaled(
      STATS,
      scaled(
        ranks(60, 95, 130),
        add('attackDamage', 1.2),
        add('abilityPower', 0.5),
        add('maxHealth', 0.08, { from: 'target' })
      ),
      { ranks: 3 }
    );

    const caster = unit({ attackDamage: 100, abilityPower: 50 });
    const target = unit({ maxHealth: 2000 });

    assert.equal(evaluateScaled(damage, { caster, target, rank: 2 }), 400);
    assert.equal(evaluateScaled(damage, { caster, target, rank: 1 }), 365);
    assert.equal(evaluateScaled(damage, { caster, target, rank: 9 }), 435, 'past the last rank reads the last');
    assert.equal(evaluateScaled(damage, { caster, rank: 2 }), 240, 'without a target, target terms are left out');
  });

  it('shorten a cooldown through the haste curve: 12 s × 100 / (100 + 0.5 × haste)', () => {
    const cooldown = compileScaled(STATS, scaled(12, haste(0.5)));

    assert.equal(evaluateScaled(cooldown, { caster: unit({ abilityHaste: 100 }) }), 8);
    assert.equal(evaluateScaled(cooldown, { caster: unit({}) }), 12);
  });

  it('evaluate in the fixed order (base + Σ add) × Π amp × curve(Σ curve terms)', () => {
    const value = compileScaled(STATS, scaled(10, add('attackDamage', 0.1), amp('damage', 1.1), haste(0.5)));

    const caster = unit({ attackDamage: 100, damage: 1.35, abilityHaste: 10 });

    assert.equal(evaluateScaled(value, { caster }), 26.380952380952383);
    // Grouping the factors any other way lands a different last bit.
    assert.equal(20 * (1.3850000000000002 * 0.9523809523809523), 26.380952380952387);
  });

  it('read the bonus over the base for of: bonus, and a per-rank ratio at the rank', () => {
    const value = compileScaled(
      STATS,
      scaled(0, add('attackDamage', 0.6, { of: 'bonus' }), add('abilityPower', ranks(0.5, 0.6, 0.7)))
    );

    const caster = unit({ attackDamage: 100, abilityPower: 100 });

    assert.equal(evaluateScaled(value, { caster, rank: 1 }), 74);
    assert.equal(evaluateScaled(value, { caster, rank: 3 }), 94);
  });
});

describe('the share-of-1 rule', () => {
  it('reads a multiplier stat as it is at a share of exactly 1, and 1 + share × (M − neutral) otherwise', () => {
    assert.equal(shareOf(0.3, 1), 0.3);
    assert.equal(1 + 1 * (0.3 - 1), 0.30000000000000004, 'what the formula would give');
    assert.equal(shareOf(1.3, 1.1), 1.33);
    assert.equal(shareOf(1.3, 0), 1, 'a share of 0 ignores the stat');
    assert.equal(shareOf(0.2, 1, 0), 1.2, 'the shortcut is for a neutral of 1 only');
  });

  it('holds for amp terms, so an outgoing multiplier with the default share stays bit-exact', () => {
    const value = compileScaled(STATS, scaled(10, amp('damage', 1)));

    assert.equal(evaluateScaled(value, { caster: unit({ damage: 0.3 }) }), 3);
  });
});

describe('snapshots (decision 2)', () => {
  it('freeze the caster part at the cast and finish against each target with the full formula', () => {
    const value = compileScaled(
      STATS,
      scaled(10, add('attackDamage', 1), add('maxHealth', 0.1, { from: 'target' }), amp('damage', 1.1))
    );

    const totals = { attackDamage: 100, damage: 1.35 };
    const caster = unit(totals);
    const snapshot = snapshotScaled(value, { caster, rank: 1 });

    totals.attackDamage = 999;

    const first = unit({ maxHealth: 1000 });
    const second = unit({ maxHealth: 300 });

    assert.equal(
      finishScaled(snapshot, first),
      evaluateScaled(value, { caster: unit({ attackDamage: 100, damage: 1.35 }), target: first })
    );
    assert.equal(finishScaled(snapshot, second), 193.90000000000003);
    assert.equal(finishScaled(snapshot), 152.35000000000002);
    assert.equal(snapshotScaled(value, { caster }, snapshot), snapshot, 'a snapshot of the same value is reused');
  });

  it('freeze the caster stats curve parameters read too', () => {
    const value = compileScaled(STATS, {
      base: 1,
      curve: {
        kind: hyperbolic({ k: scaled(400, add('level', 85)) }),
        by: [{ stat: 'maxHealth', coef: 1, from: 'target' }]
      }
    });

    assert.deepEqual(value.casterStats, [id.level]);

    const totals = { level: 60 };
    const snapshot = snapshotScaled(value, { caster: unit(totals) });

    totals.level = 1;

    assert.equal(finishScaled(snapshot, unit({ maxHealth: 5500 })), 0.5);
  });
});

describe('explanations', () => {
  it('give the base, each term with its ratio and reading, and the total, as data', () => {
    const value = compileScaled(
      STATS,
      scaled(ranks(60, 95), add('attackDamage', 1.2), add('maxHealth', 0.08, { from: 'target' }))
    );

    const preview = explainScaled(value, 2);

    assert.deepEqual(preview, {
      kind: 'scaled',
      rank: 2,
      base: 95,
      terms: [
        {
          op: 'add',
          stat: id.attackDamage,
          coef: 1.2,
          of: 'total',
          from: 'caster',
          value: undefined
        },
        { op: 'add', stat: id.maxHealth, coef: 0.08, of: 'total', from: 'target', value: undefined }
      ],
      curve: undefined,
      total: undefined,
      isPartial: false
    });

    const cast = explainScaled(value, 2, { caster: unit({ attackDamage: 100 }) });

    assert.equal(cast.terms[0]?.value, 100);
    assert.equal(cast.total, 215);
    assert.equal(cast.isPartial, true);
  });
});

describe('load-time checks', () => {
  it('refuse an add on a multiplier stat, an amp on a flat stat, and a bonus with no base', () => {
    assert.throws(() => compileScaled(STATS, scaled(1, add('damage', 1))), /add term needs a flat stat; damage/);
    assert.throws(() => compileScaled(STATS, scaled(1, amp('attackDamage', 1))), /amp term needs a multiplier stat/);
    assert.throws(() => compileScaled(STATS, scaled(1, add('abilityPower', 1, { of: 'bonus' }))), /needs a base/);
    assert.throws(() => compileScaled(STATS, scaled(1, amp('damage', 1, { of: 'bonus' }))), /drop of: 'bonus'/);
  });

  it('refuse per-rank lists that do not match the ranks, or each other', () => {
    assert.throws(
      () => compileScaled(STATS, scaled(ranks(1, 2)), { ranks: 3 }),
      /2 entries, which does not match its 3 ranks/
    );
    assert.throws(
      () => compileScaled(STATS, scaled(ranks(1, 2), add('attackDamage', ranks(1, 2, 3)))),
      /3 entries, which does not match the other lists/
    );
  });

  it('refuse two curves, a curve term no stat declares, and unknown stats', () => {
    assert.throws(() => scaled(1, haste(1), curveOf(hyperbolic({ k: 1 }), 1, { stat: 'level' })), /one curve at most/);
    const loose: StatTable = STATS;

    assert.throws(() => compileScaled(loose, scaled(1, curveOf('haste', 1, { stat: 'nope' }))), /no stat named nope/);

    const table = defineStats({ level: { base: 1, kind: 'flat' } });

    assert.throws(() => compileScaled(table, scaled(1, haste(1))), /no stat declares its curve/);
  });
});
