import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AURA_HOOKS,
  type AuraDef,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import { checkOrder, createBitset, TOMBSTONE } from '../../src/core/index.ts';
import { aura, CLOCKS, makeGame, TAGS } from '../helpers/aura-game.ts';

const onApplied = () => ['applied'];

describe('defineAuras', () => {
  it('gives each aura its id by key order, keeps a retired slot, and pins the order', () => {
    const registry = defineAuras({ bleed: aura({ duration: 1 }), old: TOMBSTONE, stun: aura({ duration: 2 }) });

    assert.deepEqual(registry.id, { bleed: 0, old: 1, stun: 2 });
    assert.deepEqual(registry.ids, [0, 2]);
    assert.equal(registry.isRetired(registry.id.old), true);
    assert.throws(() => registry.get(registry.id.old), /retired/);
    checkOrder(registry, ['bleed', 'old', 'stun']);
  });

  it('builds typed columns, hook tables and has bitsets', () => {
    const registry = defineAuras({
      bleed: aura({ duration: 1, stacking: 'stack', maxStacks: 300, merge: 'add', onApplied }),
      stun: aura({ duration: 2, stacking: (): undefined => undefined, audience: 'owner', perSource: true }),
    });

    assert.deepEqual(Array.from(registry.columns.stacking), [2, 5]);
    assert.deepEqual(Array.from(registry.columns.maxStacks), [300, 1]);
    assert.deepEqual(Array.from(registry.columns.merge), [2, 0]);
    assert.deepEqual(Array.from(registry.columns.flags), [0, 9]);
    assert.equal(registry.hooks.onApplied[0], onApplied);
    assert.deepEqual(registry.has.onApplied.toArray(), [0]);
    assert.deepEqual(Object.keys(registry.has), [...AURA_HOOKS]);
  });

  it('freezes definitions, never changes them, and runs their hooks detached', () => {
    const def = aura({ duration: 1, tags: ['magic'], onApplied });
    const { auras, id, unit, run, registry } = makeGame({ def });
    const u = unit();
    const { onApplied: hook } = registry.get(id.def);

    auras.apply(u, id.def);

    const active = auras.find(u, id.def);

    assert.equal(Object.isFrozen(def), true);
    assert.equal(Object.isFrozen(def.tags), true);
    assert.deepEqual(active === undefined ? [] : hook?.(auras.context(u, active)), ['applied']);
    run(u, 100);
    assert.deepEqual(def, { duration: 1, tags: ['magic'], onApplied });
  });

  it('refuses unsound definitions, naming them', () => {
    assert.throws(() => defineAuras({ a: aura({ maxStacks: 0 }) }), /Aura a: maxStacks/);
    assert.throws(() => defineAuras({ b: aura({ maxStacks: 1.5 }) }), /Aura b: maxStacks/);
    assert.throws(() => defineAuras({ c: aura({ duration: -1 }) }), /Aura c: duration/);
    assert.throws(() => defineAuras({ d: aura({ value: Number.NaN }) }), /Aura d: duration/);
    assert.throws(() => defineAuras({ e: aura({ periodic: { every: -1, onBeat: () => undefined } }) }), /Aura e/);
    assert.throws(() => defineAuras({ e: aura({ periodic: { every: 0, onBeat: () => undefined } }) }), /above 0/);
    assert.throws(() => defineAuras({ f: aura({ stacking: 'independent', perSource: true }) }), /Aura f/);
  });
});

describe('createAuraSystem', () => {
  const clocks = CLOCKS;
  it('resolves every name at load and refuses an unknown one', () => {
    const system = (def: AuraDef) => () =>
      createAuraSystem({ registry: defineAuras({ def }), tags: TAGS, clocks, states: ['down'] });

    assert.throws(system(defineAura({ tags: ['cursed'] })), /Aura def tag: there is no cursed/);
    assert.throws(system(defineAura({ clock: 'solar' })), /Aura def: there is no clock solar/);
    assert.throws(system(defineAura({ removedOn: ['dead'] })), /Aura def: there is no bearer state dead/);
  });

  it('numbers its clocks by declaration order, the first the default', () => {
    const { auras, id, unit } = makeGame({ a: aura({ duration: 1 }), b: aura({ duration: 1, clock: 'motion' }) });
    const u = unit();

    auras.apply(u, id.a);
    auras.apply(u, id.b);
    assert.deepEqual(auras.clocks, { world: 0, motion: 1 });
    assert.deepEqual(
      u.auras.list.map((a) => a.clock),
      [0, 1],
    );
  });

  it('refuses a state made by another hand, and a system with no clock', () => {
    const { auras, id } = makeGame({ a: aura({ duration: 1 }) });
    const forged = { list: [], tags: createBitset(), clocks: [], changes: 0, isSilent: false, serials: 0 };

    assert.throws(() => auras.has({ id: 1, hp: 1, auras: forged }, id.a), /createState/);
    assert.throws(
      () => createAuraSystem({ registry: defineAuras({}), tags: defineAuraTags([]), clocks: {} }),
      /from 1 to 255 clocks/,
    );
  });
});
