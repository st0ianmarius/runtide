import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProcOutcome } from '../../src/procs/index.ts';
import { summon } from '../../src/units/index.ts';
import { makeUnitGame, type UnitGame } from '../helpers/unit-game.ts';

test('a nested replacement summon cannot exceed the owner cap', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const proc = summon<UnitGame>('pet', { limit: { perOwner: 1 } });
  g.procs.apply(proc, { self: owner });
  g.on('despawned', (e) => {
    if (e.reason === 'replaced') {
      g.procs.apply(proc, { self: owner });
    }
  });
  g.procs.apply(proc, { self: owner });
  assert.equal(g.units.summonsOf(owner).length, 1);
});

test('a multi-summon stops when a spawn listener kills the owner', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  g.on('spawned', (e) => {
    if (e.unit?.template === g.id.pet) {
      g.units.kill(owner);
    }
  });
  g.procs.apply(summon<UnitGame>('pet', { count: 3 }), { self: owner });
  assert.equal(owner.lifecycle, 'dead');
  assert.equal(g.units.summonsOf(owner).length, 0);
});

for (const event of ['spawned', 'replaced', 'position'] as const) {
  test(`summoning stops when ${event} despawns its owner`, () => {
    const g = makeUnitGame({ owner: {}, pet: {} });
    const owner = g.units.spawn(g.id.owner, { side: 1 });

    const proc = summon<UnitGame>('pet', {
      count: 3,
      limit: { perOwner: 1 },

      atOf: () => {
        if (event === 'position') {
          g.units.despawn(owner);
        }
        return { x: 0, z: 0 };
      }
    });

    g.on('spawned', (e) => {
      if (event === 'spawned' && e.unit?.template === g.id.pet) {
        g.units.despawn(owner);
      }
    });
    g.on('despawned', (e) => {
      if (event === 'replaced' && e.reason === 'replaced') {
        g.units.despawn(owner);
      }
    });
    g.procs.apply(proc, { self: owner });
    assert.equal(owner.lifecycle, 'despawned');
    assert.equal(g.units.summonsOf(owner).length, 0);
  });
}

test('replacement rechecks capacity after a direct spawn in its callback', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const proc = summon<UnitGame>('pet', { limit: { perOwner: 1 } });
  g.procs.apply(proc, { self: owner });
  g.on('despawned', (e) => {
    if (e.reason === 'replaced') {
      g.units.spawn(g.id.pet, { side: 1, owner });
    }
  });
  g.procs.apply(proc, { self: owner });
  assert.equal(g.units.summonsOf(owner).length, 1);
});

test('replacement reservations are released after a throwing callback', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const proc = summon<UnitGame>('pet', { limit: { perOwner: 1 } });
  g.procs.apply(proc, { self: owner });
  let shouldThrow = true;
  g.on('despawned', (e) => {
    if (e.reason === 'replaced' && shouldThrow) {
      throw new Error('replacement');
    }
  });
  assert.throws(() => g.procs.apply(proc, { self: owner }), /replacement/);
  shouldThrow = false;
  g.procs.apply(proc, { self: owner });
  assert.equal(g.units.summonsOf(owner).length, 1);
});

test('an outer replacement keeps its slot when a callback spawns directly and summons again', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  const proc = summon<UnitGame>('pet', { limit: { perOwner: 1 } });
  g.procs.apply(proc, { self: owner });
  const first = g.units.summonsOf(owner)[0];
  const inner: ProcOutcome[] = [];
  g.on('despawned', (e) => {
    if (e.reason === 'replaced' && e.unit === first) {
      g.units.spawn(g.id.pet, { side: 1, owner });
      inner.push(g.procs.apply(proc, { self: owner }));
    }
  });
  const outer = g.procs.apply(proc, { self: owner });
  assert.equal(inner[0]?.status, 'skipped');
  assert.equal(outer.status, 'landed');
  assert.equal(g.units.summonsOf(owner).length, 1);
});

test('every bound summon despawns with its owner when one summon’s despawn listener throws', () => {
  const g = makeUnitGame({ owner: {}, pet: {} });
  const owner = g.units.spawn(g.id.owner, { side: 1 });
  g.procs.apply(summon<UnitGame>('pet', { count: 3 }), { self: owner });
  const pets = g.units.summonsOf(owner).slice();
  g.on('despawned', (e) => {
    if (e.unit === pets[0]) {
      throw new Error('first pet');
    }
  });
  assert.throws(() => g.units.despawn(owner), /first pet/);
  assert.deepEqual(
    pets.map((pet) => pet.lifecycle),
    ['despawned', 'despawned', 'despawned']
  );
});
