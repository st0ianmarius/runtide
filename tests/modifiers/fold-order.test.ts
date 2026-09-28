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
 * The fold's documented contract written out plainly over one stat's lists, with no conditions or scopes:
 * `clamp(min((base + Σ add) × Π mul, …caps))`, where an add lands `value × stacks`, a mul `value ^ stacks` (or
 * `1 + (value − 1) × stacks` when linear) and either lands its authored value at one stack; additions sum left to
 * right and multipliers apply one at a time, both in source order; each cap below the value replaces it, in turn;
 * the clamp takes the ceiling, then the floor.
 */
const documented = (
  lists: readonly (readonly Authored[])[],
  stat: { readonly base: number; readonly min: number; readonly max: number },
): number => {
  const all = lists.flat();
  const ofOp = (op: Authored['op']) => all.filter((m) => m.op === op);
  const atStacks = (m: Authored, many: number) => (m.stacks === 1 ? m.value : many);

  const added = ofOp('add').reduce((sum, m) => sum + atStacks(m, m.value * m.stacks), stat.base);

  const multiplied = ofOp('mul').reduce(
    (product, m) => product * atStacks(m, m.isLinear ? 1 + (m.value - 1) * m.stacks : m.value ** m.stacks),
    added,
  );

  // A cap (and each side of the clamp) replaces the value only when it is strictly past it, so a -0 cap keeps a 0.
  const capped = ofOp('min').reduce((value, m) => (m.value < value ? m.value : value), multiplied);
  const ceiled = capped > stat.max ? stat.max : capped;

  return ceiled < stat.min ? stat.min : ceiled;
};

const authored = fc.record({
  op: fc.constantFrom('add', 'mul', 'min' as const),
  value: fc.double({ min: -4, max: 4, noNaN: true, noDefaultInfinity: true }),
  stacks: fc.integer({ min: 1, max: 4 }),
  isLinear: fc.boolean(),
});

describe('the fold’s float order (property)', () => {
  it('lands the documented float to the bit: adds in order, muls one by one in source order, caps in turn, clamp', () => {
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
            documented(withStacks, { base: 1.5, min: -2, max: 40 }),
          );
        },
      ),
    );
  });
});
