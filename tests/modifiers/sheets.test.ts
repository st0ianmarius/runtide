import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineConditions, defineValues } from '../../src/conditions/index.ts';
import {
  cap,
  createModifierSystem,
  defineSources,
  defineStats,
  hostValue,
  mul,
  perStat,
  plus,
  type StatChange,
  watchStats,
} from '../../src/modifiers/index.ts';

/** A creature-like host (§II.6 M9): health, and aura stacks by gate. */
interface Host {
  hp: number;
  readonly maxHp: number;
  readonly stacks: number[];
  tests: number;
}

const creature = (over: Partial<Host> = {}): Host => ({ hp: 100, maxHp: 100, stacks: [], tests: 0, ...over });

const game = () => {
  const stats = defineStats({
    damage: { base: 1, kind: 'multiplier' },
    moveSpeed: { base: 4, kind: 'flat' },
    projectiles: { base: 1, kind: 'multiplier' },
    chainJumps: { base: 0, kind: 'flat' },
    maxHp: { base: 100, kind: 'flat', min: 1 },
  });

  const sources = defineSources(['base', 'talents', 'auras']);

  const conditions = defineConditions({
    enraged: (host: Host) => {
      host.tests += 1;

      return host.hp < host.maxHp / 2;
    },
  });

  const values = defineValues({
    missingHealth: (host: Host, max) => 1 + max * (1 - host.hp / host.maxHp),
  });

  const system = createModifierSystem({
    stats,
    sources,
    conditions,
    values,
    stacks: (host: Host, gate) => host.stacks[gate] ?? 0,
  });

  return { stats, sources, system, id: stats.id };
};

describe('the per-bearer cache (§I.5.4)', () => {
  it('compiles once, on the first read after a source changes, and reuses the lists between reads', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    assert.equal(sheet.isDirty, true);
    assert.equal(system.resolve(sheet, id.damage), 1);
    assert.equal(sheet.compiles, 1);
    system.resolve(sheet, id.moveSpeed);
    assert.equal(sheet.compiles, 1, 'cached between reads');

    system.setSource(sheet, sources.id.talents, [system.compile([mul('damage', 1.3)])]);

    assert.equal(sheet.isDirty, true);
    assert.equal(system.resolve(sheet, id.damage), 1.3);
    assert.equal(sheet.compiles, 2, 'a source change recompiles');
  });

  it('evaluates conditions and gates on every read, never recompiling for them', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const host = creature();

    system.setSource(sheet, sources.id.auras, [
      system.compile([mul('damage', 1.5, { when: { is: 'enraged' } })]),
      system.compile([mul('damage', 1.2)], { gate: 0 }),
    ]);

    assert.equal(system.resolve(sheet, id.damage, { host }), 1);
    host.hp = 40;
    assert.equal(system.resolve(sheet, id.damage, { host }), 1.5);
    host.stacks[0] = 1;
    assert.equal(system.resolve(sheet, id.damage, { host }), 1.7999999999999998);
    assert.equal(sheet.compiles, 1);
    assert.equal(host.tests, 3);
  });

  it('folds lists shared by every sheet after each sheet’s own lists at their source, recompiling each sheet once', () => {
    const { system, sources, id } = game();
    const hero = system.createSheet();
    const mob = system.createSheet();
    const host = creature({ stacks: [0, 1] });

    system.setSource(hero, sources.id.auras, [system.compile([mul('moveSpeed', 0.51)])]);
    system.share(sources.id.auras, [system.compile([mul('moveSpeed', 0.54)], { gate: 1 })]);

    assert.equal(system.resolve(hero, id.moveSpeed, { host }), 1.1016000000000001);
    assert.equal(system.resolve(mob, id.moveSpeed, { host }), 2.16);
    assert.equal(system.resolve(hero, id.moveSpeed, { host }), 1.1016000000000001);
    assert.deepEqual([hero.compiles, mob.compiles], [1, 1]);

    system.share(sources.id.auras, []);

    assert.equal(system.resolve(mob, id.moveSpeed, { host }), 4);
    assert.equal(mob.compiles, 2);
  });

  it('refuses a sheet made elsewhere and a source the game did not declare', () => {
    const { system, id } = game();

    assert.throws(() => system.resolve({ isDirty: false, compiles: 0 }, id.damage), /modifier system/);
    const foreign = defineSources(['a', 'b', 'c', 'd']).id.d;

    assert.throws(() => {
      system.setSource(system.createSheet(), foreign, []);
    }, /not a modifier source/);
  });
});

describe('values that follow a stat or the bearer (§II.6 M2, M3)', () => {
  it('follow another stat’s bonus for the same read, capped per source', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.talents, [
      system.compile([
        plus('projectiles', 0.6),
        plus('chainJumps', perStat('projectiles', 2)),
        plus('chainJumps', perStat('projectiles', 10, { cap: 3 })),
      ]),
    ]);

    assert.equal(system.resolve(sheet, id.projectiles), 1.6);
    assert.equal(system.resolve(sheet, id.chainJumps), 4.2);
  });

  it('read the bearer through a game value kind, and count only with a host', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.base, [system.compile([mul('moveSpeed', hostValue('missingHealth', 0.5))])]);

    assert.equal(system.resolve(sheet, id.moveSpeed), 4);
    assert.equal(system.resolve(sheet, id.moveSpeed, { host: creature() }), 4);
    assert.equal(system.resolve(sheet, id.moveSpeed, { host: creature({ hp: 0 }) }), 6);
    assert.equal(system.resolve(sheet, id.moveSpeed, { host: creature({ hp: 50 }) }), 5);
  });

  it('refuse a stat that follows itself', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();

    system.setSource(sheet, sources.id.talents, [
      system.compile([plus('chainJumps', perStat('projectiles', 1)), plus('projectiles', perStat('chainJumps', 1))]),
    ]);

    assert.throws(() => system.resolve(sheet, id.damage), /follows itself/);
  });
});

describe('stat watches (§II.6 M7)', () => {
  it('raise each watched stat that moved since the sheet’s last check, in the listed order', () => {
    const { system, sources, id } = game();
    const sheet = system.createSheet();
    const heard: StatChange[] = [];

    const watch = watchStats(system, {
      stats: [id.maxHp, id.moveSpeed],
      onChange: (change) => heard.push({ ...change }),
    });

    watch.check(sheet);
    assert.deepEqual(heard, [], 'the first check records');

    system.setSource(sheet, sources.id.talents, [system.compile([mul('maxHp', 1.5), cap('moveSpeed', 3)])]);
    watch.check(sheet);
    watch.check(sheet);

    assert.deepEqual(heard, [
      { sheet, stat: id.maxHp, before: 100, after: 150 },
      { sheet, stat: id.moveSpeed, before: 4, after: 3 },
    ]);
  });
});
