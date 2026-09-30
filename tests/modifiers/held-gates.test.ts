import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { cap, createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';

/** A host: the stacks of each gate, and the held report listing the gates with any. */
interface Host {
  readonly stacks: readonly number[];
}

/** The gates a host holds, in ascending order, with a stale zero-stack gate left in (the report may list extras). */
const heldOf = (host: Host): readonly { readonly id: number }[] =>
  host.stacks.flatMap((stacks, id) => (stacks > 0 || id === 3 ? [{ id }, { id }] : []));

const stats = defineStats({
  speed: { base: 6, kind: 'flat', min: 0 },
  damage: { base: 1, kind: 'multiplier' },
  armor: { base: 0, kind: 'flat' },
});

const sources = defineSources(['base', 'auras', 'late']);

/** Twelve gated lists: speed on nine gates (a marker), damage on three at `late` (inline), armor on two (inline). */
const GATED = [
  { gate: 0, source: 'auras', modifiers: [mul('speed', 1.07), plus('armor', 3.3)] },
  { gate: 1, source: 'auras', modifiers: [mul('speed', 0.91), plus('speed', 0.35)] },
  { gate: 2, source: 'auras', modifiers: [mul('speed', 1.13, { stacking: 'linear' })] },
  { gate: 3, source: 'auras', modifiers: [plus('speed', -0.7), cap('speed', 7.7)] },
  { gate: 4, source: 'auras', modifiers: [mul('speed', 1.21)] },
  { gate: 5, source: 'late', modifiers: [mul('damage', 1.1), mul('speed', 0.97)] },
  { gate: 6, source: 'auras', modifiers: [mul('speed', 1.03), plus('armor', 1.1)] },
  { gate: 7, source: 'late', modifiers: [mul('damage', 0.9)] },
  { gate: 8, source: 'auras', modifiers: [plus('speed', 0.15)] },
  { gate: 9, source: 'auras', modifiers: [mul('speed', 1.3)] },
  { gate: 10, source: 'late', modifiers: [mul('damage', 1.3), cap('speed', 9.1)] },
  { gate: 11, source: 'auras', modifiers: [mul('speed', 0.83)] },
] as const;

/** A system sharing the gated lists, walking held gates or asking every gate, with a sheet holding own lists. */
const system = (walksHeld: boolean) => {
  const modifiers = createModifierSystem({
    stats,
    sources,
    stacks: (host: Host, gate) => host.stacks[gate] ?? 0,
    ...(walksHeld ? { held: heldOf } : {}),
  });

  for (const source of ['auras', 'late'] as const) {
    const lists = GATED.filter((list) => list.source === source).map((list) =>
      modifiers.compile(list.modifiers, { gate: list.gate }),
    );

    modifiers.share(sources.id[source], lists);
  }

  const sheet = modifiers.createSheet();

  modifiers.setSource(sheet, sources.id.base, [modifiers.compile([plus('speed', 0.45), mul('damage', 1.05)])]);
  modifiers.setSource(sheet, sources.id.auras, [modifiers.compile([mul('speed', 1.01), plus('armor', 0.2)])]);
  modifiers.setSource(sheet, sources.id.late, [modifiers.compile([mul('speed', 1.11), cap('speed', 8.3)])]);

  return { modifiers, sheet };
};

describe('shared lists walked by held gates', () => {
  it('fold the same floats as asking every gate, inline or behind a marker, what-ifs and reads without a host too', () => {
    const [held, every] = [system(true), system(false)];
    const gate = fc.integer({ min: 0, max: GATED.length - 1 });

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: GATED.length, maxLength: GATED.length }),
        gate,
        fc.integer({ min: 0, max: 3 }),
        (stacks, whatIf, whatIfStacks) => {
          const host = { stacks };
          const reads = [{ host }, { host, whatIf: { gate: whatIf, stacks: whatIfStacks } }, {}];

          for (const stat of Object.values(stats.id)) {
            for (const read of reads) {
              assert.equal(
                held.modifiers.resolve(held.sheet, stat, read),
                every.modifiers.resolve(every.sheet, stat, read),
              );
            }

            assert.deepEqual(
              held.modifiers.explainStat(held.sheet, stat, { host }),
              every.modifiers.explainStat(every.sheet, stat, { host }),
            );
          }
        },
      ),
    );
  });

  it('count a held gate’s lists by its stacks, and nothing for a gate not held', () => {
    const { modifiers, sheet } = system(true);
    const host = { stacks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0] };
    const base = 6 + 0.45;

    assert.equal(modifiers.resolve(sheet, stats.id.speed, { host }), Math.min(base * 1.01 * 1.3 ** 2 * 1.11, 8.3));
    assert.equal(modifiers.resolve(sheet, stats.id.speed, { host: { stacks: [] } }), Math.min(base * 1.01 * 1.11, 8.3));
  });
});
