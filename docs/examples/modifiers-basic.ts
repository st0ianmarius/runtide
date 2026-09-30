import assert from 'node:assert/strict';

import { cap, createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';

// #region quick-start
const stats = defineStats({
  attackDamage: { base: 60, kind: 'flat', min: 0 },
  moveSpeed: { base: 6, kind: 'flat', min: 0, max: 12 },
  damage: { base: 1, kind: 'multiplier', min: 0 }
});

const sources = defineSources(['base', 'gear', 'talents', 'auras']);
const modifiers = createModifierSystem({ stats, sources });
const sheet = modifiers.createSheet();

const boots = modifiers.compile([plus('moveSpeed', 1)], { what: 'boots' });
const training = modifiers.compile([mul('moveSpeed', 1.5), cap('moveSpeed', 10)], { what: 'training' });

modifiers.setSource(sheet, sources.id.gear, [boots]);
modifiers.setSource(sheet, sources.id.talents, [training]);

const speed = modifiers.resolve(sheet, stats.id.moveSpeed); // 10: (6 + 1) × 1.5, capped at 10.
const damage = modifiers.resolve(sheet, stats.id.attackDamage); // 60: no modifier changes this stat.

modifiers.setSource(sheet, sources.id.gear, []); // Remove every gear list from this sheet.

const unequippedSpeed = modifiers.resolve(sheet, stats.id.moveSpeed); // 9: 6 × 1.5.
// #endregion quick-start

assert.equal(speed, 10);
assert.equal(damage, 60);
assert.equal(unequippedSpeed, 9);
assert.equal(sheet.compiles, 2);
