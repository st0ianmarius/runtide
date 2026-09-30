import assert from 'node:assert/strict';

import {
  type AuraBearer,
  auraGates,
  auraRevision,
  auraStacks,
  type AuraTypes,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags
} from '../../src/auras/index.ts';
import {
  createModifierSystem,
  defineSources,
  defineStats,
  type FoldRead,
  mul,
  plus
} from '../../src/modifiers/index.ts';

// #region aura-setup
interface Hero extends AuraBearer {
  readonly id: number;
}

interface GameAuras extends AuraTypes {
  readonly bearer: Hero;
  readonly stat: 'armor' | 'moveSpeed';
  readonly condition: never;
  readonly valueKind: never;
  readonly source: 'base' | 'gear' | 'auras';
  readonly tag: 'boon';
  readonly clock: 'world';
  readonly state: 'dead';
  readonly ext: undefined;
}

const stats = defineStats({
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat', min: 0 }
});

const sources = defineSources(['base', 'gear', 'auras']);

const modifiers = createModifierSystem({
  stats,
  sources,
  stacks: auraStacks,
  held: auraGates,
  revision: auraRevision
});

const aura = defineAura<GameAuras>;

const registry = defineAuras({
  guard: aura({
    duration: 10,
    stacking: 'stack',
    maxStacks: 3,
    tags: ['boon'],
    modifiers: [plus('armor', 30)]
  }),
  stride: aura({
    duration: 10,
    stacking: 'stack',
    maxStacks: 3,
    modifiers: [mul('moveSpeed', 1.1, { stacking: 'linear' })]
  })
});

const auras = createAuraSystem<GameAuras>({
  registry,
  tags: defineAuraTags(['boon']),
  clocks: { world: { dt: 0.125 } },
  states: ['dead'],
  modifiers,
  fold: 'auras'
});

const hero: Hero = { id: 1, auras: auras.createState() };
const sheet = modifiers.createSheet();
const read: FoldRead<Hero> = { host: hero };
// #endregion aura-setup

// #region aura-lifecycle
assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);

auras.apply(hero, { aura: registry.id.guard, stacks: 2 });

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 60);

auras.apply(hero, { aura: registry.id.stride, stacks: 3 });

assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6 * (1 + (1.1 - 1) * 3));
assert.equal(
  modifiers.resolve(sheet, stats.id.armor, { host: hero, whatIf: { gate: registry.id.guard, stacks: 0 } }),
  0
);

auras.remove(hero, registry.id.guard);

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);

for (let tick = 0; tick < 80; tick++) {
  auras.tick(hero, 'world'); // The host owns which bearer clocks it steps and when.
}

assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6);
assert.equal(sheet.compiles, 1); // Apply, remove and expire only changed gates and their revision.
// #endregion aura-lifecycle
