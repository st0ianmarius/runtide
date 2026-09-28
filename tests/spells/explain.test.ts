import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { add, ranks, scaled, type StatView } from '../../src/modifiers/index.ts';
import { defineSpells, explainSpell, previewStats } from '../../src/spells/index.ts';
import { type Game, spell, SPELL_TAGS, STATS } from '../helpers/spell-game.ts';

/** A view of the stat table's bases with some stats changed. */
const statsWith = (changes: Readonly<Partial<Record<keyof typeof STATS.id, number>>>): StatView => {
  const totals = Float64Array.from(STATS.columns.base);

  for (const [name, value] of Object.entries(changes)) {
    const id = STATS.index.idOf(name);

    if (id !== undefined && value !== undefined) {
      totals[id] = value;
    }
  }

  return { total: (stat) => totals[stat] ?? 0, base: (stat) => STATS.columns.base[stat] ?? 0 };
};

/** The test spells: a scaled nova, a ranked auto swing with a stats function, an ai slam. */
const SPELLS = () =>
  defineSpells<Game, 'nova' | 'swing' | 'slam'>(
    {
      nova: spell({
        activation: { kind: 'trigger' },
        tags: ['fire', 'area'],
        ranks: 3,
        stats: {
          damage: scaled(ranks(10, 20, 30), add('power', 0.5), add('maxHealth', 0.1, { from: 'target' })),
          radius: 4,
        },
        scaling: { damage: 1.1 },
        timeline: { channel: { seconds: 2, every: 0.5 }, recover: { seconds: (ctx) => ctx.stats.radius } },
        release: () => undefined,
      }),
      swing: spell({
        activation: { kind: 'auto', interval: 1.5, retry: 0.25 },
        stats: (ctx) => ({ reach: 2 + ctx.rank, label: 'unused' }),
        release: () => undefined,
      }),
      slam: spell({
        activation: { kind: 'ai', windup: 1.2, lock: 0.3, recover: 0.5 },
        release: () => undefined,
      }),
    },
    { tags: SPELL_TAGS, stats: STATS },
  );

describe('stat previews (§II.6 M6)', () => {
  it("evaluates a table at a rank against the stat table's bases, with no world", () => {
    const registry = SPELLS();

    assert.deepEqual(previewStats(registry, registry.id.nova, { rank: 2 }), { damage: 25, radius: 4 });
  });

  it("reads the given caster's stats, and a target's to finish target terms", () => {
    const registry = SPELLS();

    assert.deepEqual(
      previewStats(registry, registry.id.nova, {
        rank: 3,
        view: statsWith({ power: 20 }),
        target: statsWith({ maxHealth: 300 }),
      }),
      { damage: 30 + 10 + 30, radius: 4 },
    );
  });

  it('calls a stats function with the rank and no caster', () => {
    const registry = SPELLS();

    assert.deepEqual(previewStats(registry, registry.id.swing, { rank: 2 }), { reach: 4, label: 'unused' });
    assert.deepEqual(previewStats(registry, registry.id.slam), {});
  });
});

describe('explainSpell (§I.5.3, §II.6 M6)', () => {
  it('explains its tags, activation, stats at a rank, shares and timeline as data', () => {
    const registry = SPELLS();
    const explained = explainSpell(registry, registry.id.nova, { rank: 2 });

    assert.equal(explained.kind, 'spell');
    assert.equal(explained.rank, 2);
    assert.deepEqual(explained.tags, [SPELL_TAGS.id.fire, SPELL_TAGS.id.area]);
    assert.deepEqual(explained.activation, { kind: registry.activations.id['trigger'], values: {} });
    assert.deepEqual(explained.scaling, [{ stat: STATS.id.damage, share: 1.1 }]);
    assert.deepEqual(explained.timeline, { windup: undefined, channel: 2, every: 0.5, recover: 'cast' });

    const [damage, radius] = explained.stats;

    assert.equal(damage?.key, 'damage');
    assert.ok(typeof damage?.value === 'object');
    assert.equal(damage.value.base, 20);
    assert.equal(damage.value.total, 25);
    assert.equal(damage.value.isPartial, true);
    assert.deepEqual(
      damage.value.terms.map((term) => [term.stat, term.coef, term.from]),
      [
        [STATS.id.power, 0.5, 'caster'],
        [STATS.id.maxHealth, 0.1, 'target'],
      ],
    );
    assert.equal(radius?.key, 'radius');
  });

  it("explains an activation's numbers, and a stats function's numbers only", () => {
    const registry = SPELLS();
    const swing = explainSpell(registry, registry.id.swing, { rank: 3 });
    const slam = explainSpell(registry, registry.id.slam);

    assert.deepEqual(swing.activation.values, { interval: 1.5, retry: 0.25 });
    assert.deepEqual(swing.stats, [{ key: 'reach', value: 5 }]);
    assert.deepEqual(slam.activation.values, { windup: 1.2, lock: 0.3, recover: 0.5 });
    assert.deepEqual(slam.timeline, { windup: 1.2, channel: undefined, every: 0, recover: 0.5 });
  });
});
