import assert from 'node:assert/strict';

import {
  add,
  amp,
  avoidance,
  basesView,
  byLevel,
  compileCurve,
  compileScaled,
  createModifierSystem,
  curveOf,
  defineCurves,
  defineSources,
  defineStats,
  evaluateCurve,
  evaluateScaled,
  explainScaled,
  finishScaled,
  freezeStats,
  haste,
  hasteCurve,
  hyperbolic,
  linear,
  plus,
  ranks,
  rating,
  scaled,
  shareOf,
  snapshotScaled,
  stacking,
  table
} from '../../src/modifiers/index.ts';

// #region stats-and-curves
const curves = defineCurves({
  haste: hasteCurve(),
  armor: hyperbolic({ k: 100, cap: 0.75, negative: 'amplify' }),
  hitRating: rating(
    byLevel([
      [1, 10],
      [60, 20]
    ])
  ),
  dodge: avoidance({ per: 10, cap: 0.65, k: 1 }),
  slowResistance: stacking(0.2),
  growth: table([
    [1, 1],
    [10, 2]
  ]),
  flatConversion: linear(0.1),
  softCap: (x) => x / (1 + Math.abs(x))
});

const stats = defineStats(
  {
    attackDamage: { base: 60, kind: 'flat', min: 0 },
    abilityPower: { base: 0, kind: 'flat' },
    abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
    damage: { base: 1, kind: 'multiplier' },
    maxHealth: { base: 600, kind: 'flat', min: 1 },
    level: { base: 1, kind: 'flat' },
    reach: { base: 1, kind: 'multiplier' },
    area: { base: 1, kind: 'multiplier', derives: { from: 'reach', per: 0.125 } },
    hitRating: { base: 0, kind: 'flat', converts: { to: 'hitChance', curve: 'hitRating' } },
    hitChance: { base: 0.05, kind: 'flat', min: 0, max: 1 },
    armor: { base: 0, kind: 'flat' }
  },
  { curves }
);

const sources = defineSources(['base', 'gear', 'talents']);
const modifiers = createModifierSystem({ stats, sources });
const sheet = modifiers.createSheet();

modifiers.setSource(sheet, sources.id.gear, [
  modifiers.compile([
    plus('attackDamage', 40),
    plus('abilityPower', 50),
    plus('abilityHaste', 100),
    plus('reach', 1),
    plus('hitRating', 150)
  ])
]);

const caster = modifiers.view(sheet);

assert.equal(caster.total(stats.id.area), 1.125);
assert.equal(caster.total(stats.id.hitChance), 0.2);

// #endregion stats-and-curves

// #region scaled-values
const damage = compileScaled(
  stats,
  scaled(
    ranks(60, 95, 130),
    add('attackDamage', 1.2),
    add('abilityPower', 0.5),
    add('maxHealth', 0.08, { from: 'target' }),
    amp('damage', 1)
  ),
  { ranks: 3, what: 'blast damage' }
);

const targetSheet = modifiers.createSheet();

modifiers.setSource(targetSheet, sources.id.base, [modifiers.compile([plus('maxHealth', 1400)])]);

const target = modifiers.view(targetSheet);

assert.equal(evaluateScaled(damage, { caster, target, rank: 2 }), 400);
assert.equal(evaluateScaled(damage, { caster, rank: 2 }), 240); // Target term omitted for this preview.

const cooldown = compileScaled(stats, scaled(12, haste(0.5)), { allowsTarget: false });

assert.equal(evaluateScaled(cooldown, { caster }), 8);

const bonus = compileScaled(stats, scaled(0, add('attackDamage', 0.6, { of: 'bonus' })));

assert.equal(evaluateScaled(bonus, { caster }), 24); // 0.6 × (100 - 60).
assert.equal(shareOf(0.3, 1), 0.3); // Avoids the different last bit of 1 + (0.3 - 1).
// #endregion scaled-values

// #region snapshots
const snapshot = snapshotScaled(damage, { caster, rank: 2 });
const frozen = freezeStats(caster, [stats.id.damage, stats.id.attackDamage]);

modifiers.setSource(sheet, sources.id.talents, [modifiers.compile([plus('attackDamage', 100)])]);

assert.equal(evaluateScaled(damage, { caster, target, rank: 2 }), 520);
assert.equal(finishScaled(snapshot, target), 400); // Caster frozen at 100 attack damage.
assert.equal(frozen.total(stats.id.attackDamage), 100);

modifiers.setSource(targetSheet, sources.id.base, [modifiers.compile([plus('maxHealth', 400)])]);

assert.equal(finishScaled(snapshot, target), 320); // Target's maximum health remains live.
// #endregion snapshots

// #region curve-evaluation
const armorCurve = compileCurve(stats, 'armor');

assert.equal(evaluateCurve(armorCurve, 100, { caster }), 0.5); // A reduction fraction, not damage remaining.
assert.equal(evaluateCurve(armorCurve, -100, { caster }), 1.5); // Amplify mode returns a damage multiplier here.

const converted = compileScaled(stats, scaled(10, curveOf('growth', 1, { stat: 'level' })));
const tableBases = basesView(stats.columns.base);

assert.equal(evaluateScaled(converted, { caster: tableBases }), 10);
assert.equal(explainScaled(damage, 2, { caster }).isPartial, true);
assert.equal(explainScaled(damage, 2).total, undefined);
// #endregion curve-evaluation
