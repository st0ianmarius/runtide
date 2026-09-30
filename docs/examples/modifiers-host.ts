import assert from 'node:assert/strict';

import { all, defineConditions, defineValues } from '../../src/conditions/index.ts';
import { createBitset } from '../../src/core/index.ts';
import {
  createModifierSystem,
  defineSources,
  defineStats,
  explainModifiers,
  type FoldRead,
  hostValue,
  mul,
  perStat,
  plus,
  sourceMask,
  type StatChange,
  watchStats
} from '../../src/modifiers/index.ts';

// #region host-setup
interface Hero {
  hp: number;
  maxHp: number;
  isStanding: boolean;
  readonly stacks: number[];
  readonly gates: { readonly id: number }[];
  revision: number;
}

const stats = defineStats({
  damage: { base: 1, kind: 'multiplier', min: 0 },
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat', min: 0 },
  reach: { base: 1, kind: 'multiplier' },
  chainJumps: { base: 0, kind: 'flat' },
  maxHealth: { base: 100, kind: 'flat', min: 1 }
});

const sources = defineSources(['base', 'gear', 'talents', 'auras']);

const conditions = defineConditions({
  standing: { test: (hero: Hero) => hero.isStanding, mirrorSafe: true },
  healthBelow: { test: (hero: Hero, share) => hero.hp < hero.maxHp * share, mirrorSafe: true }
});

const values = defineValues({
  healthShare: { read: (hero: Hero) => hero.hp / hero.maxHp, mirrorSafe: true },
  missingHealthFactor: {
    read: (hero: Hero, per) => 1 + per * (1 - hero.hp / hero.maxHp),
    mirrorSafe: true
  }
});

const modifiers = createModifierSystem({
  stats,
  sources,
  conditions,
  values,
  stacks: (hero: Hero, gate) => hero.stacks[gate] ?? 0,
  held: (hero: Hero) => hero.gates,
  revision: (hero: Hero) => hero.revision
});

const hero: Hero = { hp: 100, maxHp: 100, isStanding: true, stacks: [], gates: [], revision: 0 };
const sheet = modifiers.createSheet();
const read: FoldRead<Hero> = { host: hero };

// #endregion host-setup

// #region live-values
const talents = modifiers.compile([
  mul('damage', 1.5, { when: all({ is: 'standing' }, { is: 'healthBelow', arg: 0.4 }) }),
  plus('armor', 10, { when: { value: 'healthShare', op: '<=', than: 0.5 } }),
  mul('moveSpeed', hostValue('missingHealthFactor', 0.5)),
  plus('reach', 0.5),
  plus('chainJumps', perStat('reach', 2, { cap: 3 }))
]);

modifiers.setSource(sheet, sources.id.talents, [talents]);

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1);

hero.hp = 30; // Conditions and host values read the new health without replacing a source.

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.5);
assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 10);
assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6 * 1.35);
assert.equal(modifiers.resolve(sheet, stats.id.chainJumps, read), 1);
// #endregion live-values

// #region scoped-reads
const FIRE_SCOPE = 4;
const SPELL_SCOPE = 9;
const spellScope = createBitset([FIRE_SCOPE, SPELL_SCOPE]);
const gearOnly = sourceMask(sources, ['gear']);

modifiers.setSource(sheet, sources.id.gear, [modifiers.compile([mul('damage', 2, { scope: FIRE_SCOPE })])]);

const spellRead: FoldRead<Hero> = { host: hero, scope: spellScope };
const partialRead: FoldRead<Hero> = { host: hero, scope: spellScope, sources: gearOnly };

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.5);
assert.equal(modifiers.resolve(sheet, stats.id.damage, spellRead), 3);
assert.equal(modifiers.resolve(sheet, stats.id.damage, partialRead), 2);
// #endregion scoped-reads

// #region shared-gates
const ARMOR_GATE = 0;
const armorAura = modifiers.compile([plus('armor', 30)], { gate: ARMOR_GATE });

modifiers.share(sources.id.auras, [armorAura]);

hero.stacks[ARMOR_GATE] = 2;
hero.gates.push({ id: ARMOR_GATE }); // Keep this report sorted by id when adding more gates.
hero.revision += 1;

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 70);

const previewRead: FoldRead<Hero> = { host: hero, whatIf: { gate: ARMOR_GATE, stacks: 3 } };

assert.equal(modifiers.resolve(sheet, stats.id.armor, previewRead), 100);
assert.equal(modifiers.resolve(sheet, stats.id.armor, { whatIf: { gate: ARMOR_GATE, stacks: 3 } }), 90);
assert.equal(hero.stacks[ARMOR_GATE], 2); // The preview did not apply an aura.
// #endregion shared-gates

// #region explanations-and-watch
const explanation = modifiers.explainStat(sheet, stats.id.armor, read);
const authored = explainModifiers(armorAura, 2);

assert.equal(explanation.total, modifiers.resolve(sheet, stats.id.armor, read));
assert.equal(authored[0]?.landed, 60);

const changes: StatChange[] = [];

const watch = watchStats(modifiers, {
  stats: [stats.id.maxHealth],
  onChange: (change) => changes.push({ ...change }) // Copy the reused callback payload if keeping it.
});

watch.check(sheet, read); // First check records the starting value; it raises no change.
modifiers.setSource(sheet, sources.id.base, [modifiers.compile([plus('maxHealth', 50)])]);
watch.check(sheet, read);

assert.equal(changes[0]?.before, 100);
assert.equal(changes[0]?.after, 150);
// #endregion explanations-and-watch

// #region kept-totals
const plainSheet = modifiers.createSheet(); // No conditional or host-valued own lists on this sheet.

assert.equal(modifiers.resolve(plainSheet, stats.id.armor, read), 60);

hero.stacks[ARMOR_GATE] = 3;
hero.revision += 1; // Required: this stat's plain total may have been kept at the old revision.

assert.equal(modifiers.resolve(plainSheet, stats.id.armor, read), 90);
assert.equal(plainSheet.compiles, 1); // A gate change did not rebuild the compiled lists.
// #endregion kept-totals
