import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraStacks, createAuraSystem, defineAuras, explainAura } from '../../src/auras/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';
import { aura, CLOCKS, TAGS, type Unit } from '../helpers/aura-game.ts';

/** A game whose aura modifiers fold through the modifier system's gates. */
const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat' },
    speed: { base: 6, kind: 'flat' },
  });

  const sources = defineSources(['base', 'auras', 'late']);
  const modifiers = createModifierSystem({ stats, sources, stacks: auraStacks });

  const registry = defineAuras({
    frenzy: aura({ duration: 10, fold: 'late', modifiers: [mul('damage', 0.9)] }),
    might: aura({ duration: 10, stacking: 'stack', maxStacks: 5, modifiers: [plus('armor', 30), mul('damage', 1.1)] }),
    fury: aura({ duration: 10, modifiers: [mul('damage', 1.3)] }),
    stride: aura({
      duration: 10,
      stacking: 'stack',
      maxStacks: 3,
      modifiers: [mul('speed', 1.07, { stacking: 'linear' })],
    }),
    rage: aura({ duration: 10, modifiers: [mul('damage', 2)], activeWhile: (bearer) => bearer.hp > 0 }),
  });

  const auras = createAuraSystem({
    registry,
    tags: TAGS,
    clocks: CLOCKS,
    modifiers,
    fold: 'auras',
    createExt: () => ({ snapshot: 0 }),
  });

  const unit = (): Unit => ({ id: 1, hp: 100, auras: auras.createState() });
  const sheet = modifiers.createSheet();

  return { auras, id: registry.id, modifiers, stats, unit, sheet };
};

describe('aura modifiers in the fold', () => {
  it('count while the aura is held: an add lands value × stacks, a mul value ^ stacks', () => {
    const { auras, id, modifiers, stats, unit, sheet } = game();
    const u = unit();
    const read = { host: u };

    assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);
    auras.apply(u, id.might);
    assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 30);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.1);
    auras.apply(u, { aura: id.might, stacks: 2 });
    assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 90);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.3310000000000004);
    auras.remove(u, id.might);
    assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);
    assert.equal(sheet.compiles, 1, 'an aura coming and going recompiles nothing');
  });

  it('stack a linear mul as 1 + (value − 1) × stacks', () => {
    const { auras, id, modifiers, stats, unit, sheet } = game();
    const u = unit();

    auras.apply(u, { aura: id.stride, stacks: 3 });
    assert.equal(modifiers.resolve(sheet, stats.id.speed, { host: u }), 7.260000000000002);
  });

  it('fold in registry order within a fold position, and at the position an aura names', () => {
    const { auras, id, modifiers, stats, unit, sheet } = game();
    const u = unit();

    auras.apply(u, id.fury);
    auras.apply(u, id.might);
    auras.apply(u, id.frenzy);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, { host: u }), 1.2870000000000001);
    // Registry order (might, fury), then the late position: not application order, nor frenzy's registry slot.
    assert.equal(1.1 * 1.3 * 0.9, 1.2870000000000001);
    assert.equal(0.9 * 1.3 * 1.1, 1.2870000000000004, 'the reverse order differs in the last bit');
  });

  it('suppress an aura modifiers while its activeWhile says so, and nothing else', () => {
    const { auras, id, modifiers, stats, unit, sheet } = game();
    const u = unit();

    auras.apply(u, id.rage);
    assert.equal(modifiers.resolve(sheet, stats.id.damage, { host: u }), 2);
    u.hp = 0;
    assert.equal(modifiers.resolve(sheet, stats.id.damage, { host: u }), 1);
    assert.equal(auras.has(u, id.rage), true);
    assert.equal(auras.stacks(u, id.rage), 1);
  });

  it('answer a what-if read by gate without touching the bearer', () => {
    const { id, modifiers, stats, unit, sheet } = game();
    const u = unit();

    assert.equal(modifiers.resolve(sheet, stats.id.armor, { host: u, whatIf: { gate: id.might, stacks: 2 } }), 60);
  });

  it('explain the modifiers at a stack count, as data', () => {
    const { auras, id, stats } = game();
    const explanation = explainAura(auras, id.might, 3);

    assert.deepEqual(
      explanation.modifiers.map((m) => [m.stat, m.op, m.landed]),
      [
        [stats.id.armor, 'add', 90],
        [stats.id.damage, 'mul', 1.3310000000000004],
      ],
    );
  });

  it('refuse modifiers without a modifier system or a fold source', () => {
    const registry = defineAuras({ might: aura({ duration: 1, modifiers: [plus('armor', 1)] }) });
    const clocks = CLOCKS;
    const createExt = () => ({ snapshot: 0 });

    assert.throws(() => createAuraSystem({ registry, tags: TAGS, clocks, createExt }), /fold source/);

    const { modifiers } = game();

    assert.throws(() => createAuraSystem({ registry, tags: TAGS, clocks, createExt, modifiers }), /fold source/);
  });
});
