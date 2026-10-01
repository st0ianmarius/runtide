import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  add,
  byLevel,
  compileCurve,
  compileScaled,
  type Curve,
  curveOf,
  customCurve,
  defineCurves,
  defineStats,
  evaluateCurve,
  evaluateScaled,
  finishScaled,
  hyperbolic,
  linear,
  rating,
  scaled,
  snapshotScaled,
  stacking,
  type StatView,
  table
} from '../../src/modifiers/index.ts';
import { avoidance, HASTE } from '../helpers/curves.ts';

const STATS = defineStats({
  level: { base: 1, kind: 'flat' },
  armor: { base: 0, kind: 'flat' }
});

/** A unit's folded stats as a plain view, by stat id. */
const unit = (totals: readonly number[]): StatView => ({
  total: (stat) => totals[stat] ?? 0,
  base: (stat) => STATS.columns.base[stat] ?? 0
});

/** A curve compiled against the table and evaluated at `x` for a caster (and a target). */
const at = (
  curve: Curve<'level' | 'armor'> | string,
  x: number,
  sides: { caster?: StatView; target?: StatView } = {}
) =>
  evaluateCurve(compileCurve(STATS, curve), x, {
    caster: sides.caster ?? unit([1, 0]),
    target: sides.target
  });

describe('the curve library', () => {
  it('linear is x × per and rating is x / per / 100', () => {
    assert.equal(at(linear(0.5), 10), 5);
    assert.equal(at(rating(10), 150), 0.15);
  });

  it('hyperbolic is x / (x + k), capped, and 0 at or below zero unless it amplifies', () => {
    assert.equal(at(hyperbolic({ k: 100 }), 100), 0.5);
    assert.equal(at(hyperbolic({ k: 100 }), 0), 0);
    assert.equal(at(hyperbolic({ k: 100 }), -50), 0);
    assert.equal(at(hyperbolic({ k: 100, negative: 'amplify' }), -50), 1.3333333333333335);
    assert.equal(at(hyperbolic({ k: 100, cap: 0.75 }), 1000), 0.75);
    // An armor-style reduction: rating / (rating + k) for a positive rating, as one division.
    assert.equal(at(hyperbolic({ k: 83 }), 37), 37 / (37 + 83));
    assert.equal(at(hyperbolic({ k: 83 }), 37), 0.30833333333333335);
  });

  it('stacking is 1 − (1 − rate)^x', () => {
    assert.equal(at(stacking(0.3), 2), 0.51);
    assert.equal(at(stacking(0), 5), 0);
  });

  it('table is piecewise linear, holding its end values outside its range', () => {
    const steps = table([
      [0, 0],
      [10, 1],
      [20, 1.5]
    ]);

    assert.deepEqual(
      [-1, 0, 5, 10, 15, 20, 30].map((x) => at(steps, x)),
      [0, 0, 0.5, 1, 1.25, 1.5, 1.5]
    );
  });

  it('takes game curves by name, plain functions as custom curves', () => {
    const curves = defineCurves({ haste: HASTE, halve: (x) => x / 2 });
    const stats = defineStats({ level: { base: 1, kind: 'flat' } }, { curves });
    const view = { total: () => 0, base: () => 0 };

    assert.equal(evaluateCurve(compileCurve(stats, 'halve'), 9, { caster: view }), 4.5);
    assert.equal(compileCurve(stats, 'halve').id, curves.id.halve);
    assert.throws(() => compileCurve(stats, 'soft'), /no curve named soft/);
  });
});

describe('custom curves', () => {
  it('map the input with a game function: LoL ability haste, a slow below zero', () => {
    assert.equal(at(HASTE, 100), 0.5);
    assert.equal(at(HASTE, 50), 0.6666666666666666);
    assert.equal(at(HASTE, -100), 2);
    assert.equal(at(HASTE, -300), 4);
  });

  it('receive their parameters evaluated: WoW avoidance with a rating per 1% by level', () => {
    const dodge = avoidance({
      per: byLevel([
        [1, 10],
        [60, 20]
      ]),
      cap: 0.6563,
      k: 0.956
    });

    assert.equal(at(dodge, 400, { caster: unit([60, 0]) }), 0.1586371562398329);
    assert.equal(at(dodge, 200, { caster: unit([1, 0]) }), 0.1586371562398329);
    assert.equal(at(dodge, 0), 0);
  });

  it('let snapshots see the stats their parameters read, and refuse a target read where there is none', () => {
    const k = customCurve((x, { k }) => x / (x + k), { k: scaled(0, add('level', 10)) });
    const value = compileScaled(STATS, scaled(100, curveOf(k, 1, { stat: 'armor' })));
    const snapshot = snapshotScaled(value, unit([10, 100]));

    assert.deepEqual(value.casterStats, [STATS.id.armor, STATS.id.level]);
    assert.equal(evaluateScaled(value, { caster: unit([10, 100]) }), 50);
    // A stat the snapshot missed would read NaN.
    assert.equal(finishScaled(snapshot), 50);

    const byTarget = customCurve((x, { k }) => x * k, { k: scaled(0, add('level', 1, { from: 'target' })) });

    assert.throws(
      () => compileScaled(STATS, scaled(1, curveOf(byTarget, 1, { stat: 'armor' })), { allowsTarget: false }),
      /no target/
    );
  });

  it('refuse a parameter that is not finite, whatever its sign', () => {
    assert.throws(
      () => defineCurves({ bad: customCurve((x) => x, { k: Number.NaN }) }),
      /k is NaN; it must be finite\./
    );
    assert.doesNotThrow(() => defineCurves({ shift: customCurve((x, { by }) => x + by, { by: -5 }) }));
  });
});

describe('curve parameters read either side of the hit', () => {
  it('as scaled values: WoW’s armor constant 400 + 85 × attacker level', () => {
    const curve = hyperbolic({ k: scaled(400, add('level', 85)), cap: 0.75 });

    assert.equal(at(curve, 5500, { caster: unit([60, 0]) }), 0.5);
    assert.equal(at(curve, 5500, { caster: unit([1, 0]) }), 0.75, 'k = 485: 5500 / 5985 is above the cap');
  });

  it('as scaled values on the target, and as a table lookup by level', () => {
    const byTarget = linear(scaled(0, add('level', 0.01, { from: 'target' })));

    const perLevel = rating(
      byLevel([
        [1, 10],
        [60, 15.8]
      ])
    );

    assert.equal(at(byTarget, 100, { target: unit([30, 0]) }), 30);
    assert.equal(at(perLevel, 158, { caster: unit([60, 0]) }), 0.1);
    assert.throws(() => at(rating(byLevel([[1, 10]], { from: 'target' })), 5), /no target/);
  });
});

describe('curve parameter checks', () => {
  it('refuse k ≤ 0, a cap outside (0, 1], a rating per at or below zero, a rate outside [0, 1]', () => {
    assert.throws(() => defineCurves({ bad: hyperbolic({ k: 0 }) }), /k is 0; it must be finite and k > 0/);
    assert.throws(() => defineCurves({ bad: hyperbolic({ k: 100, cap: 1.5 }) }), /0 < cap ≤ 1/);
    assert.throws(() => defineCurves({ bad: hyperbolic({ k: 100, cap: 0 }) }), /0 < cap ≤ 1/);
    assert.throws(() => defineCurves({ bad: rating(0) }), /per > 0/);
    assert.throws(() => defineCurves({ bad: stacking(1.5) }), /0 ≤ rate ≤ 1/);
    assert.throws(
      () =>
        defineCurves({
          bad: rating(
            byLevel([
              [1, 10],
              [60, 0]
            ])
          )
        }),
      /per > 0/
    );
    assert.throws(() => defineCurves({ bad: hyperbolic({ k: scaled(-5, add('level', 1)) }) }), /k > 0/);
  });

  it('refuse a table that is empty or not strictly ascending', () => {
    assert.throws(() => defineCurves({ bad: table([]) }), /at least one/);
    assert.throws(
      () =>
        defineCurves({
          bad: table([
            [1, 0],
            [1, 2]
          ])
        }),
      /point 1/
    );
  });
});
