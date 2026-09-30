import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineConditions } from '../../src/conditions/index.ts';
import { createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';

/** A host: its gate stacks, a revision it moves when they change, a flag a condition reads, and a count of reads. */
interface Host {
  stacks: number;
  revision: number;
  isEnraged: boolean;
  asked: number;
}

const stats = defineStats({
  speed: { base: 6, kind: 'flat' },
  damage: { base: 1, kind: 'multiplier' }
});

const sources = defineSources(['base', 'auras']);

const conditions = defineConditions({ enraged: (host: Host) => host.isEnraged });

/** A system keeping totals by the host's revision, a gated speed list, and a sheet with a conditional damage. */
const kept = () => {
  const modifiers = createModifierSystem({
    stats,
    sources,
    conditions,

    stacks: (host: Host) => {
      host.asked += 1;

      return host.stacks;
    },

    revision: (host: Host) => host.revision
  });

  modifiers.share(sources.id.auras, [modifiers.compile([mul('speed', 0.5)], { gate: 0 })]);

  const sheet = modifiers.createSheet();

  modifiers.setSource(sheet, sources.id.base, [modifiers.compile([mul('damage', 2, { when: { is: 'enraged' } })])]);

  const host: Host = { stacks: 0, revision: 0, isEnraged: false, asked: 0 };

  return { modifiers, sheet, host, read: { host } };
};

describe('kept totals', () => {
  it('keep a plain total until the host’s revision moves', () => {
    const { modifiers, sheet, host, read } = kept();

    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 6);
    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 6);
    assert.equal(host.asked, 1);
    host.stacks = 1;
    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 6);
    host.revision += 1;
    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 3);
  });

  it('fold again after the sheet’s lists change, and for a scoped or what-if read', () => {
    const { modifiers, sheet, host, read } = kept();

    modifiers.resolve(sheet, stats.id.speed, read);
    modifiers.setSource(sheet, sources.id.base, [modifiers.compile([plus('speed', 1)])]);
    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 7);
    assert.equal(modifiers.resolve(sheet, stats.id.speed, { host, whatIf: { gate: 0, stacks: 1 } }), 3.5);
    assert.equal(modifiers.resolve(sheet, stats.id.speed, read), 7);
  });

  it('never keep a total whose fold asked a condition', () => {
    const { modifiers, sheet, host, read } = kept();

    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1);
    host.isEnraged = true;
    assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 2);
  });
});
