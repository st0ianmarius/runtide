import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineValues } from '../../src/conditions/index.ts';
import {
  add,
  againstValue,
  basesView,
  compileScaled,
  createModifierSystem,
  defineSources,
  defineStats,
  finishScaled,
  linear,
  mul,
  plus,
  rating,
  scaled,
  snapshotScaled
} from '../../src/modifiers/index.ts';

/** A bearer: its health share, and a revision its auras move. */
interface Host {
  share: number;
  revision: number;
}

const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    power: { base: 10, kind: 'flat' },
    area: { base: 1, kind: 'multiplier', derives: { from: 'power', per: 0.1 } },
    hitRating: { base: 0, kind: 'flat', converts: { to: 'hitChance', curve: rating(10) } },
    hitChance: { base: 0.05, kind: 'flat', max: 1 }
  });

  const sources = defineSources(['base', 'auras']);

  const values = defineValues({
    theirMissing: (unit: Host, max) => 1 + max * (1 - unit.share)
  });

  const system = createModifierSystem({
    stats,
    sources,
    values,
    stacks: () => 1,
    revision: (host: Host) => host.revision
  });

  return { stats, sources, values, system, id: stats.id };
};

/** A stat id past the game's five stats: the sixth of a bigger table. */
const PAST = defineStats({
  a: { base: 0, kind: 'flat' },
  b: { base: 0, kind: 'flat' },
  c: { base: 0, kind: 'flat' },
  d: { base: 0, kind: 'flat' },
  e: { base: 0, kind: 'flat' },
  f: { base: 0, kind: 'flat' }
}).id.f;

describe('a view of bases alone', () => {
  it('reads every total as the base, and 0 past the list', () => {
    const { stats } = game();
    const view = basesView(stats.columns.base);

    assert.equal(view.total(stats.id.power), 10);
    assert.equal(view.base(stats.id.power), 10);
    assert.equal(view.total(stats.id.hitChance), 0.05);
    assert.equal(view.total(PAST), 0);
    assert.equal(view.base(PAST), 0);
  });
});

describe('a sheet with bases of its own', () => {
  it('folds from them, measures a derived gain from them, and its view reads them as the base', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const own = new Float64Array([1, 25, 1, 0, 0.05]);

    system.setSource(sheet, sources.id.auras, [system.compile([plus('power', 5)])]);
    assert.equal(system.resolve(sheet, id.area), 1.5, 'before: the gain over the table base of 10 is 15');

    system.setBases(sheet, own);

    const view = system.view(sheet);

    assert.equal(system.resolve(sheet, id.power), 30);
    assert.equal(system.resolve(sheet, id.area), 1.5, 'the gain over its own base of 25 is 5');
    assert.equal(view.total(id.power), 30);
    assert.equal(view.base(id.power), 25);
    assert.equal(view.base(PAST), 0);
  });

  it('measures a conversion curve’s bonus term from them', () => {
    const stats = defineStats({
      level: { base: 1, kind: 'flat' },
      hitRating: {
        base: 0,
        kind: 'flat',
        converts: { to: 'hitChance', curve: linear({ base: 0, add: [{ stat: 'level', coef: 0.001, of: 'bonus' }] }) }
      },
      hitChance: { base: 0, kind: 'flat' }
    });

    const sources = defineSources(['gear']);
    const system = createModifierSystem({ stats, sources });
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.gear, [system.compile([plus('hitRating', 100), plus('level', 9)])]);
    assert.equal(
      system.resolve(sheet, stats.id.hitChance),
      0.9000000000000001,
      '100 × 0.001 per bonus level, 9 of them'
    );

    system.setBases(sheet, new Float64Array([5, 0, 0]));
    assert.equal(system.resolve(sheet, stats.id.hitChance), 0.9000000000000001, 'level 14 over its own base of 5');
  });

  it('drops the totals a read kept by the host’s revision when its bases change', () => {
    const { system, id } = game();
    const sheet = system.createSheet();
    const host: Host = { share: 1, revision: 0 };

    assert.equal(system.resolve(sheet, id.power, { host }), 10);
    system.setBases(sheet, new Float64Array([1, 40, 1, 0, 0.05]));
    assert.equal(system.resolve(sheet, id.power, { host }), 40, 'the same revision reads the new bases');
  });
});

describe('values read against another unit', () => {
  it('count only for a read against a unit, through the game value kind', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const host: Host = { share: 1, revision: 0 };
    const wounded: Host = { share: 0.25, revision: 0 };

    system.setSource(sheet, sources.id.auras, [system.compile([mul('damage', againstValue('theirMissing', 0.4))])]);

    assert.equal(system.resolve(sheet, id.damage), 1);
    assert.equal(system.resolve(sheet, id.damage, { host }), 1, 'no unit to read against');
    assert.equal(system.resolve(sheet, id.damage, { host, against: wounded }), 1.3);
    assert.equal(system.resolve(sheet, id.damage, { host, against: host }), 1);
    assert.equal(system.resolve(sheet, id.damage, { host, against: wounded }), 1.3, 'kept totals never hide it');
  });
});

describe('explaining a rating conversion', () => {
  it('lists the conversion with its input and what it added, at the same total as resolve', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.auras, [system.compile([plus('hitRating', 150), plus('hitChance', 0.01)])]);

    const explained = system.explainStat(sheet, id.hitChance);

    assert.deepEqual(explained.derived, [{ kind: 'converts', from: id.hitRating, input: 150, value: 0.15 }]);
    assert.equal(explained.total, 0.21);
    assert.equal(explained.total, system.resolve(sheet, id.hitChance));
  });
});

describe('finishing a snapshot', () => {
  it('evaluates a snapshot the game assembled itself like one it took', () => {
    const { stats, id } = game();
    const value = compileScaled(stats, scaled(5, add('power', 2), add('power', 1, { from: 'target' })));
    const caster = { total: (stat: number) => (stat === id.power ? 20 : 0), base: () => 0 };
    const target = { total: (stat: number) => (stat === id.power ? 7 : 0), base: () => 0 };
    const taken = snapshotScaled(value, caster, 1);
    const assembled = { value, caster, rank: 1 };

    assert.equal(finishScaled(taken), 45);
    assert.equal(finishScaled(assembled), 45);
    assert.equal(finishScaled(taken, target), 52);
    assert.equal(finishScaled(assembled, target), 52);
  });
});

describe('the compiled cache', () => {
  it('stays right across more list combinations than it keeps, when an old one comes back', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const first = system.compile([plus('power', 1)]);
    const variants = Array.from({ length: 10 }, (_unused, i) => system.compile([plus('power', 10 * (i + 1))]));

    system.setSource(sheet, sources.id.base, [first]);

    for (const [i, variant] of variants.entries()) {
      system.setSource(sheet, sources.id.auras, [variant]);
      assert.equal(system.resolve(sheet, id.power), 21 + 10 * i);
    }

    for (const [i, variant] of variants.entries()) {
      system.setSource(sheet, sources.id.auras, [variant]);
      assert.equal(system.resolve(sheet, id.power), 21 + 10 * i, `combination ${i} again`);
    }

    assert.equal(sheet.compiles, 20);
  });
});

describe('shared lists that follow a stat', () => {
  it('are refused when they close a loop with a sheet’s own stat-valued modifier', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.share(sources.id.auras, [
      system.compile([plus('power', { kind: 'stat', stat: 'hitRating', per: 1 })], { gate: 0 })
    ]);
    system.setSource(sheet, sources.id.base, [
      system.compile([plus('hitRating', { kind: 'stat', stat: 'power', per: 1 })])
    ]);

    assert.throws(() => system.resolve(sheet, id.damage), /follows itself/);
  });
});
