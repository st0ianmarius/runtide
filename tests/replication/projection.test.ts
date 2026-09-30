import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';
import { defineProjection } from '../../src/replication/index.ts';

/** A modifier system with a base, gear and a source the mirror folds itself, and one sheet. */
const setUp = () => {
  const stats = defineStats({
    speed: { base: 6, kind: 'flat' },
    armor: { base: 0, kind: 'flat' },
    damage: { base: 1, kind: 'multiplier' },
  });

  const sources = defineSources(['gear', 'motion']);
  const modifiers = createModifierSystem({ stats, sources });
  const sheet = modifiers.createSheet();

  modifiers.setSource(sheet, sources.id.gear, [modifiers.compile([plus('speed', 2), plus('armor', 30)])]);
  modifiers.setSource(sheet, sources.id.motion, [modifiers.compile([mul('speed', 1.5)])]);

  return { modifiers, sheet };
};

describe('stat projections', () => {
  it('writes the declared stats in order, folded over every source or only the chosen ones', () => {
    const { modifiers, sheet } = setUp();
    const full = defineProjection(modifiers, { stats: ['speed', 'armor'] });
    const base = defineProjection(modifiers, { stats: ['speed'], sources: ['gear'] });
    const out = new Float64Array(2);

    assert.deepEqual([...full.write(sheet, out)], [12, 30]);
    assert.deepEqual(base.write(sheet, [0]), [8]);
    assert.deepEqual(full.names, ['speed', 'armor']);
    assert.equal(base.sources, 1);
    assert.equal(full.sources, undefined);
  });

  it('refuses a stat the table does not have', () => {
    const { modifiers } = setUp();
    const spec = { stats: ['speed' as const] };

    Reflect.set(spec.stats, 0, 'luck');
    assert.throws(() => defineProjection(modifiers, spec), /names no stat luck/);
  });
});
