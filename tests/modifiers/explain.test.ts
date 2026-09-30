import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { defineConditions } from '../../src/conditions/index.ts';
import {
  cap,
  createModifierSystem,
  defineSources,
  defineStats,
  explainModifier,
  explainModifiers,
  type Modifier,
  mul,
  plus,
} from '../../src/modifiers/index.ts';

const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    armor: { base: 0, kind: 'flat', min: 0, max: 500 },
    reach: { base: 1, kind: 'multiplier' },
    area: { base: 1, kind: 'multiplier', derives: { from: 'reach', per: 0.125 } },
  });

  const sources = defineSources(['race', 'gear', 'talents', 'auras']);
  const conditions = defineConditions({ below: (hp: number, share) => hp < share });
  const system = createModifierSystem({ stats, sources, conditions, stacks: (_hp: number, gate) => gate });

  return { stats, sources, system, id: stats.id };
};

describe('modifier explanations', () => {
  it('are data: the stat id, the op, the value, the stacking and the condition, never text', () => {
    const { system, id } = game();

    const list = system.compile([
      mul('damage', 1.3, { when: { is: 'below', arg: 0.4 } }),
      plus('armor', 30, { scope: 2 }),
    ]);

    assert.deepEqual(explainModifiers(list), [
      {
        kind: 'modifier',
        stat: id.damage,
        op: 'mul',
        value: 1.3,
        stacking: 'power',
        when: { kind: 'is', condition: 0, arg: 0.4 },
        scope: undefined,
        stacks: 1,
        landed: 1.3,
      },
      {
        kind: 'modifier',
        stat: id.armor,
        op: 'add',
        value: 30,
        stacking: 'power',
        when: undefined,
        scope: 2,
        stacks: 1,
        landed: 30,
      },
    ]);
  });

  it('say what a modifier lands with at a number of stacks', () => {
    const { system } = game();

    const [power, linear, capped, add] = system.compile([
      mul('damage', 1.1),
      mul('damage', 1.1, { stacking: 'linear' }),
      cap('armor', 50),
      plus('armor', 30),
    ]).modifiers;

    assert.equal(power && explainModifier(power, 3).landed, 1.3310000000000004);
    assert.equal(linear && explainModifier(linear, 3).landed, 1.3000000000000003);
    assert.equal(capped && explainModifier(capped, 3).landed, 50);
    assert.equal(add && explainModifier(add, 3).landed, 90);
  });
});

describe('stat explanations', () => {
  it('give each step of the fold with what it landed, and the same total as resolve', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.race, [system.compile([plus('area', 0.1)])]);
    system.setSource(sheet, sources.id.talents, [system.compile([plus('reach', 1)])]);
    system.setSource(sheet, sources.id.auras, [system.compile([mul('area', 2)], { gate: 3 })]);

    const explained = system.explainStat(sheet, id.area, { host: 0 });

    assert.equal(explained.total, system.resolve(sheet, id.area, { host: 0 }));
    assert.equal(explained.total, 9.8);
    assert.deepEqual(explained.derived, [{ kind: 'derives', from: id.reach, input: 1, value: 0.125 }]);
    assert.deepEqual(
      explained.muls.map(({ source, gate, stacks, value }) => ({ source, gate, stacks, value })),
      [{ source: sources.id.auras, gate: 3, stacks: 3, value: 8 }],
    );

    assert.deepEqual(explained.clamp, { min: -Infinity, max: Infinity });
  });

  it('mark what did not count for the read', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.gear, [system.compile([mul('damage', 2, { when: { is: 'below', arg: 10 } })])]);

    const explained = system.explainStat(sheet, id.damage, { host: 50 });

    assert.deepEqual(
      explained.muls.map(({ stacks, value }) => ({ stacks, value })),
      [{ stacks: 0, value: undefined }],
    );

    assert.equal(explained.total, 1);
  });

  it('always total to the float resolve returns, for any build (property)', () => {
    const { system, sources, stats } = game();
    const statName = fc.constantFrom('damage', 'armor', 'reach', 'area' as const);
    const value = fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true });

    const modifier = fc.record({
      stat: statName,
      op: fc.constantFrom('add', 'mul', 'min' as const),
      value,
      isConditional: fc.boolean(),
    });

    const build = fc.array(fc.tuple(fc.constantFrom(...sources.ids), fc.array(modifier, { maxLength: 4 })), {
      maxLength: 5,
    });

    fc.assert(
      fc.property(build, fc.integer({ min: 0, max: 20 }), (entries, hp) => {
        const sheet = system.createSheet();

        for (const [source, modifiers] of entries) {
          const authored = modifiers.map((m): Modifier<keyof typeof stats.id, 'below', never> => ({
            stat: m.stat,
            op: m.op,
            value: m.value,
            ...(m.isConditional ? { when: { is: 'below', arg: 10 } } : {}),
          }));

          system.setSource(sheet, source, [system.compile(authored)]);
        }

        for (const stat of stats.ids) {
          assert.equal(system.explainStat(sheet, stat, { host: hp }).total, system.resolve(sheet, stat, { host: hp }));
        }
      }),
    );
  });
});
