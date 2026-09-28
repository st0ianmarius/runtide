import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { createModifierSystem, defineSources, defineStats, type Modifier } from '../../src/modifiers/index.ts';

/** One authored modifier on the one stat under test. */
interface Authored {
  readonly op: 'add' | 'mul' | 'min';
  readonly value: number;
  readonly stacks: number;
  readonly isLinear: boolean;
}

/**
 * Swarm's `resolve` (`packages/game/src/modifiers/resolve.ts`) written out over one stat's lists, with no conditions or
 * scopes: the reference the fold must match to the bit.
 */
const reference = (
  lists: readonly (readonly Authored[])[],
  stat: { readonly base: number; readonly min: number; readonly max: number },
): number => {
  const all = lists.flat();
  let value = stat.base;

  for (const m of all.filter((each) => each.op === 'add')) {
    value += m.stacks <= 1 ? m.value : m.value * m.stacks;
  }

  for (const m of all.filter((each) => each.op === 'mul')) {
    if (m.stacks <= 1) {
      value *= m.value;
    } else {
      value *= m.isLinear ? 1 + (m.value - 1) * m.stacks : m.value ** m.stacks;
    }
  }

  for (const m of all.filter((each) => each.op === 'min')) {
    if (m.value < value) {
      value = m.value;
    }
  }

  if (value > stat.max) {
    value = stat.max;
  }

  return value < stat.min ? stat.min : value;
};

const authored = fc.record({
  op: fc.constantFrom('add', 'mul', 'min' as const),
  value: fc.double({ min: -4, max: 4, noNaN: true, noDefaultInfinity: true }),
  stacks: fc.integer({ min: 1, max: 4 }),
  isLinear: fc.boolean(),
});

describe('the fold’s float order (property)', () => {
  it('matches swarm’s resolve to the bit: adds in order, muls one by one in source order, caps in turn, clamp', () => {
    const stats = defineStats({ power: { base: 1.5, kind: 'flat', min: -2, max: 40 } });
    const sources = defineSources(['s0', 's1', 's2', 's3']);

    const system = createModifierSystem({
      stats,
      sources,
      stacks: (stacks: readonly number[], gate) => stacks[gate] ?? 0,
    });

    fc.assert(
      fc.property(
        fc.array(fc.array(authored, { maxLength: 4 }), { minLength: 4, maxLength: 4 }),
        fc.boolean(),
        (lists, reversed) => {
          const sheet = system.createSheet();
          const stacks: number[] = [];

          // Set the sources in either order: the fold order is the declared one, never the order they were set in.
          const order = reversed ? [...sources.ids].reverse() : sources.ids;

          for (const source of order) {
            const gated = (lists[source] ?? []).map((m) => {
              stacks.push(m.stacks);

              const modifier: Modifier<'power', never, never> = {
                stat: 'power',
                op: m.op,
                value: m.value,
                ...(m.op === 'mul' && m.isLinear ? { stacking: 'linear' as const } : {}),
              };

              return system.compile([modifier], { gate: stacks.length - 1 });
            });

            system.setSource(sheet, source, gated);
          }

          const withStacks = lists.map((list) => list.map((m) => ({ ...m, isLinear: m.op === 'mul' && m.isLinear })));

          assert.equal(
            system.resolve(sheet, stats.id.power, { host: stacks }),
            reference(withStacks, { base: 1.5, min: -2, max: 40 }),
          );
        },
      ),
    );
  });
});
