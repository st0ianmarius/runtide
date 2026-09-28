import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cap,
  createModifierSystem,
  defineConditions,
  defineSources,
  defineStats,
  type Modifier,
  mul,
  plus,
  sourceMask,
} from '../../src/modifiers/index.ts';

/** A hero-like host: health and a world question the tests count. */
interface Host {
  readonly hp: number;
  readonly maxHp: number;
  readonly tags: readonly number[];
  readonly world: { standing: boolean; asked: number };
}

const host = (over: Partial<Host> = {}): Host => ({
  hp: 100,
  maxHp: 100,
  tags: [],
  world: { standing: false, asked: 0 },
  ...over,
});

/** A small game: stats shaped like swarm's (content and tuning removed), its sources in swarm's fold order. */
const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    moveSpeed: { base: 0, kind: 'flat' },
    armor: { base: 0, kind: 'flat' },
    maxHp: { base: 0, kind: 'flat', min: 1 },
    blockChance: { base: 0, kind: 'flat', min: 0, max: 0.35 },
    cooldownReduction: { base: 0, kind: 'flat', max: 0.5 },
    lifestealCap: { base: Infinity, kind: 'flat', min: 0 },
    pickupRadius: { base: 1, kind: 'multiplier' },
    abilityArea: { base: 1, kind: 'multiplier', derives: { from: 'pickupRadius', per: 0.125 } },
    handSize: { base: 3, kind: 'flat', min: 1 },
  });

  const sources = defineSources(['classBase', 'pacts', 'totem', 'passives', 'effects', 'classStates']);

  const conditions = defineConditions({
    healthBelow: (at: Host, share) => at.hp < at.maxHp * share,
    tag: (at: Host, tag) => at.tags.includes(tag),
    noTag: (at: Host, tag) => !at.tags.includes(tag),

    totemStanding: (at: Host) => {
      at.world.asked += 1;

      return at.world.standing;
    },
  });

  const system = createModifierSystem({ stats, sources, conditions });

  /** A sheet with each source's modifiers set, as `compile(sources)` took them in swarm. */
  const sheetWith = (
    entries: readonly (readonly [
      keyof typeof sources.id,
      readonly Modifier<keyof typeof stats.id, 'healthBelow' | 'tag' | 'noTag' | 'totemStanding', never>[],
    ])[],
  ) => {
    const sheet = system.createSheet();

    for (const [source, modifiers] of entries) {
      system.setSource(sheet, sources.id[source], [system.compile(modifiers)]);
    }

    return sheet;
  };

  return { stats, sources, system, sheetWith, id: stats.id };
};

describe('the fold: (base + Σ add) × Π mul, then caps, then the clamp', () => {
  it('sums additions onto the base first, then applies multipliers in source order', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      ['classBase', [plus('armor', 10)]],
      ['pacts', [mul('armor', 3)]],
      ['passives', [plus('armor', 5)]],
    ]);

    assert.equal(system.resolve(sheet, id.armor), 45);
  });

  it('lands multipliers one at a time, never pre-multiplied, so the float is a left-to-right product', () => {
    const { system, sheetWith, id } = game();

    const chain = sheetWith([
      ['classBase', [plus('moveSpeed', 6.2)]],
      ['classStates', [mul('moveSpeed', 1.1), mul('moveSpeed', 1.3), mul('moveSpeed', 0.65)]],
    ]);

    assert.equal(system.resolve(chain, id.moveSpeed), 5.762900000000001);

    const forward = sheetWith([
      ['classBase', [plus('moveSpeed', 6.2)]],
      ['pacts', [mul('moveSpeed', 0.51)]],
      ['passives', [mul('moveSpeed', 0.54)]],
    ]);

    const backward = sheetWith([
      ['classBase', [plus('moveSpeed', 6.2)]],
      ['pacts', [mul('moveSpeed', 0.54)]],
      ['passives', [mul('moveSpeed', 0.51)]],
    ]);

    // (6.2 × 0.51) × 0.54 and (6.2 × 0.54) × 0.51 differ in the last bit, and so does 6.2 × (0.51 × 0.54).
    assert.equal(system.resolve(forward, id.moveSpeed), 1.7074800000000003);
    assert.equal(system.resolve(backward, id.moveSpeed), 1.70748);
  });

  it('folds sources in the declared order whatever order they were set in', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.passives, [system.compile([mul('moveSpeed', 0.51)])]);
    system.setSource(sheet, sources.id.pacts, [system.compile([mul('moveSpeed', 0.54)])]);
    system.setSource(sheet, sources.id.classBase, [system.compile([plus('moveSpeed', 6.2)])]);

    assert.equal(system.resolve(sheet, id.moveSpeed), 1.70748);
  });

  it('resolves a stat no source touches to its base, within its clamp', () => {
    const { system, stats } = game();
    const sheet = system.createSheet();

    assert.deepEqual(
      stats.ids.map((stat) => system.resolve(sheet, stat)),
      [1, 0, 0, 1, 0, 0, Infinity, 1, 1, 3],
    );
  });

  it('clamps to the stat: block at 35%, cooldown reduction at 50%, maximum health at 1', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      ['passives', [plus('blockChance', 0.4), plus('cooldownReduction', 0.9), plus('maxHp', 10), mul('maxHp', 0)]],
    ]);

    assert.equal(system.resolve(sheet, id.blockChance), 0.35);
    assert.equal(system.resolve(sheet, id.cooldownReduction), 0.5);
    assert.equal(system.resolve(sheet, id.maxHp), 1);
    assert.equal(
      system.resolve(sheetWith([['pacts', [plus('cooldownReduction', -0.15)]]]), id.cooldownReduction),
      -0.15,
    );
  });

  it('applies caps after every multiplier, in turn, so the lowest live cap wins whatever its source', () => {
    const { system, sheetWith, id } = game();

    const below = sheetWith([
      ['classBase', [cap('armor', 25)]],
      ['pacts', [mul('armor', 2)]],
      ['passives', [plus('armor', 10), cap('armor', 30)]],
    ]);

    const capped = sheetWith([
      ['classBase', [cap('armor', 25)]],
      ['pacts', [mul('armor', 3)]],
      ['passives', [plus('armor', 10), cap('armor', 30)]],
    ]);

    assert.equal(system.resolve(below, id.armor), 20);
    assert.equal(system.resolve(capped, id.armor), 25);
  });

  it('lifts a cap below the floor back to it, and a conditional cap waits on its condition', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      ['classStates', [cap('blockChance', -1)]],
      ['pacts', [cap('lifestealCap', 0.4, { when: { is: 'tag', arg: 7 } })]],
    ]);

    assert.equal(system.resolve(sheet, id.blockChance), 0);
    assert.equal(system.resolve(sheet, id.lifestealCap, { host: host() }), Infinity);
    assert.equal(system.resolve(sheet, id.lifestealCap, { host: host({ tags: [7] }) }), 0.4);
  });
});

describe('conditions', () => {
  it('count a modifier only while they hold, and without a host every conditional one is skipped', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      [
        'pacts',
        [
          mul('damage', 1.5, { when: { is: 'healthBelow', arg: 0.4 } }),
          mul('damage', 0.9, { when: { is: 'noTag', arg: 3 } }),
        ],
      ],
      ['effects', [mul('damage', 1.4, { when: { is: 'tag', arg: 5 } })]],
    ]);

    assert.equal(system.resolve(sheet, id.damage), 1);
    assert.equal(system.resolve(sheet, id.damage, { host: host() }), 0.9);
    assert.equal(system.resolve(sheet, id.damage, { host: host({ hp: 39 }) }), 1.35);
    assert.equal(system.resolve(sheet, id.damage, { host: host({ hp: 40 }) }), 0.9, '40% is not below 40%');
    assert.equal(system.resolve(sheet, id.damage, { host: host({ tags: [5] }) }), 1.26);
    assert.equal(system.resolve(sheet, id.damage, { host: host({ tags: [3] }) }), 1);
  });

  it('are asked only by the stats that wait on them, and a partial fold leaves out whole sources', () => {
    const { system, sheetWith, sources, id } = game();

    const sheet = sheetWith([
      ['classBase', [plus('moveSpeed', 6)]],
      ['totem', [mul('moveSpeed', 0.5, { when: { is: 'totemStanding' } })]],
      ['passives', [mul('moveSpeed', 1.2)]],
    ]);

    const idle = host();
    const standing = host({ world: { standing: true, asked: 0 } });

    assert.equal(system.resolve(sheet, id.moveSpeed, { host: idle }), 7.199999999999999);
    assert.equal(system.resolve(sheet, id.moveSpeed, { host: standing }), 3.5999999999999996);
    assert.equal(system.resolve(sheet, id.damage, { host: standing }), 1);
    assert.equal(idle.world.asked + standing.world.asked, 2, 'a stat without a totem modifier never asks');

    const base = sourceMask(sources, ['classBase', 'pacts', 'totem']);

    assert.equal(system.resolve(sheet, id.moveSpeed, { host: standing, sources: base }), 3);
  });
});

describe('derived stats (§II.6 M1)', () => {
  it('add per × gain after the additions and before the multipliers', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      ['passives', [plus('pickupRadius', 1), plus('abilityArea', 0.1)]],
      ['effects', [mul('abilityArea', 2)]],
    ]);

    assert.equal(system.resolve(sheet, id.abilityArea), 2.45);
  });

  it('read the plain sum of additions when nothing multiplies or caps the followed stat (swarm float path)', () => {
    const { system, sheetWith, id } = game();

    // 0.01 + 0.11 is 0.12, while (1 + 0.01 + 0.11) − 1 is 0.1200000000000001: the plain sum keeps swarm's float.
    const sheet = sheetWith([['passives', [plus('pickupRadius', 0.01), plus('pickupRadius', 0.11)]]]);

    assert.equal(system.resolve(sheet, id.abilityArea), 1.015);
  });

  it('read the resolved total when a live cap moves the followed stat', () => {
    const { system, sheetWith, id } = game();

    const sheet = sheetWith([
      ['passives', [plus('pickupRadius', 2)]],
      ['pacts', [cap('pickupRadius', 2)]],
    ]);

    assert.equal(system.resolve(sheet, id.pickupRadius), 2);
    assert.equal(system.resolve(sheet, id.abilityArea), 1.125);
  });

  it('never subtract when the followed stat sits below its base', () => {
    const { system, sheetWith, id } = game();

    assert.equal(system.resolve(sheetWith([['pacts', [mul('pickupRadius', 0.5)]]]), id.abilityArea), 1);
  });
});
