import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBitset } from '../../src/core/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';

/** A host that reports aura stacks by gate. */
interface Host {
  readonly stacks: readonly number[];
}

const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    attackSpeed: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat' },
    chainJumps: { base: 0, kind: 'flat' },
    moveSpeed: { base: 0, kind: 'flat' },
  });

  const sources = defineSources(['race', 'talents', 'auras', 'stance']);
  const system = createModifierSystem({ stats, sources, stacks: (host: Host, gate) => host.stacks[gate] ?? 0 });

  return { stats, sources, system, id: stats.id };
};

describe('gated lists (an aura’s modifiers)', () => {
  it('count only while the host reports stacks, an add as value × stacks and a mul as value ^ stacks', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.auras, [system.compile([plus('armor', 30), mul('damage', 1.1)], { gate: 2 })]);

    assert.equal(system.resolve(sheet, id.armor), 0, 'no host, no gate');
    assert.equal(system.resolve(sheet, id.armor, { host: { stacks: [] } }), 0);
    assert.equal(system.resolve(sheet, id.armor, { host: { stacks: [0, 0, 1] } }), 30);
    assert.equal(system.resolve(sheet, id.armor, { host: { stacks: [0, 0, 3] } }), 90);
    assert.equal(system.resolve(sheet, id.damage, { host: { stacks: [0, 0, 1] } }), 1.1);
    assert.equal(system.resolve(sheet, id.damage, { host: { stacks: [0, 0, 3] } }), 1.3310000000000004);
  });

  it('stack a linear mul as 1 + (value − 1) × stacks, and keep the authored float at one stack', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.race, [system.compile([plus('moveSpeed', 6)])]);
    system.setSource(sheet, sources.id.talents, [
      system.compile([mul('moveSpeed', 1.07, { stacking: 'linear' })], { gate: 0 }),
    ]);

    assert.equal(system.resolve(sheet, id.moveSpeed, { host: { stacks: [1] } }), 6.42);
    assert.equal(system.resolve(sheet, id.moveSpeed, { host: { stacks: [3] } }), 7.260000000000002);
    // As a power it would be 6 × 1.07³ (with a tolerance: `**` can differ in the last bit between platforms).
    assert.ok(Math.abs(6 * 1.07 ** 3 - 7.350258) < 1e-12);
  });

  it('answer a what-if read (+1 stack, or without it) without touching the host', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const host = { stacks: [2] };

    system.setSource(sheet, sources.id.auras, [system.compile([plus('armor', 30)], { gate: 0 })]);

    assert.equal(system.resolve(sheet, id.armor, { host }), 60);
    assert.equal(system.resolve(sheet, id.armor, { host, whatIf: { gate: 0, stacks: 3 } }), 90);
    assert.equal(system.resolve(sheet, id.armor, { host, whatIf: { gate: 0, stacks: 0 } }), 0);
    assert.equal(system.resolve(sheet, id.armor, { whatIf: { gate: 0, stacks: 1 } }), 30, 'a preview needs no host');
  });

  it('are refused by a system with no stacks report', () => {
    const stats = defineStats({ armor: { base: 0, kind: 'flat' } });
    const sources = defineSources(['auras']);
    const system = createModifierSystem({ stats, sources });
    const list = system.compile([plus('armor', 1)], { gate: 0 });

    assert.throws(() => {
      system.setSource(system.createSheet(), sources.id.auras, [list]);
    }, /stacks report/);
  });
});

describe('scopes', () => {
  it('reach a read only when its scope set holds them; an unscoped read skips every scoped modifier', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const spark = createBitset([4, 9]);
    const other = createBitset([5]);

    system.setSource(sheet, sources.id.talents, [
      system.compile([mul('damage', 1.2), mul('damage', 1.5, { scope: 9 }), plus('chainJumps', 2, { scope: 4 })]),
    ]);

    assert.equal(system.resolve(sheet, id.damage), 1.2);
    assert.equal(system.resolve(sheet, id.damage, { scope: other }), 1.2);
    assert.equal(system.resolve(sheet, id.damage, { scope: spark }), 1.7999999999999998);
    assert.equal(system.resolve(sheet, id.chainJumps, { scope: spark }), 2);
  });
});
