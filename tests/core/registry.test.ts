import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkOrder, createRegistry, TOMBSTONE } from '../../src/core/index.ts';

interface SpellDef {
  readonly windup?: number;
  readonly cooldown: number;
  readonly tags?: readonly string[];
  readonly onHit?: ((target: number, scale: number) => number) | undefined;
  readonly release?: (() => number) | undefined;
}

const defineSpell = (def: SpellDef): SpellDef => def;

const spells = () =>
  createRegistry(
    {
      frostNova: defineSpell({ cooldown: 8, onHit: (target, scale) => target * scale }),
      blast: defineSpell({ windup: 1.2, cooldown: 5, tags: ['fire'], release: () => 3 }),
      spark: defineSpell({ windup: 0.4, cooldown: 1, onHit: (target) => target + 1 }),
    },
    {
      kind: 'spells',
      normalize: (def) => ({ windup: 0, tags: [], onHit: undefined, release: undefined, ...def }),
      columns: {
        windup: { type: 'f64', of: (def) => def.windup ?? 0 },
        cooldown: { type: 'u8', of: (def) => def.cooldown },
      },
      hooks: ['onHit', 'release'],
    },
  );

describe('registry ids and lookups', () => {
  it('assigns dense ids by key order', () => {
    const registry = spells();

    assert.deepEqual(registry.id, { frostNova: 0, blast: 1, spark: 2 });
    assert.deepEqual(registry.names, ['frostNova', 'blast', 'spark']);
    assert.deepEqual(registry.ids, [0, 1, 2]);
    assert.equal(registry.size, 3);
    assert.equal(registry.kind, 'spells');
  });

  it('looks up names and normalised definitions by id', () => {
    const registry = spells();

    assert.equal(registry.name(registry.id.blast), 'blast');
    assert.equal(registry.get(registry.id.spark).windup, 0.4);
    assert.deepEqual(registry.get(registry.id.frostNova).tags, []);
    assert.equal(registry.defs[1], registry.get(registry.id.blast));
  });

  it('refuses an id outside the registry', () => {
    const registry = spells();
    const larger = createRegistry({ a: {}, b: {}, c: {}, d: {} }, { kind: 'spells' });

    assert.throws(() => registry.get(larger.id.d), RangeError);
    assert.throws(() => registry.name(larger.id.d), RangeError);
    assert.throws(() => registry.isRetired(larger.id.d), RangeError);
  });

  it('normalises every definition into one shape with every optional field present', () => {
    for (const def of spells().defs) {
      assert.deepEqual(Object.keys(def ?? {}), ['windup', 'tags', 'onHit', 'release', 'cooldown']);
    }
  });

  it('refuses names that look like indexes, which key order would move', () => {
    assert.throws(() => createRegistry({ a: {}, 7: {} }), RangeError);
  });
});

describe('registry freezing', () => {
  it('deep-freezes each definition and its normalised copy', () => {
    const def = { cooldown: 1, tags: ['a'], nested: { r: 2 } };
    const registry = createRegistry({ def }, { normalize: (d) => ({ ...d }) });

    assert.equal(Object.isFrozen(def), true);
    assert.equal(Object.isFrozen(def.tags), true);
    assert.equal(Object.isFrozen(def.nested), true);
    assert.equal(Object.isFrozen(registry.get(registry.id.def)), true);
    assert.throws(() => {
      Object.assign(def.nested, { r: 3 });
    }, TypeError);
  });

  it('leaves typed arrays and class instances alone', () => {
    const def = { samples: new Float64Array([1, 2]), when: new Map([[1, 2]]) };

    createRegistry({ def });

    assert.equal(Object.isFrozen(def), true);
    assert.equal(Object.isFrozen(def.when), false);
    def.samples[0] = 5;
    assert.equal(def.samples[0], 5);
  });

  it('skips freezing when asked, as a production build does', () => {
    const def = { cooldown: 1 };

    createRegistry({ def }, { freeze: false });

    assert.equal(Object.isFrozen(def), false);
  });

  it('freezes the registry and its tables', () => {
    const registry = spells();

    assert.equal(Object.isFrozen(registry), true);
    assert.equal(Object.isFrozen(registry.id), true);
    assert.equal(Object.isFrozen(registry.defs), true);
    assert.equal(Object.isFrozen(registry.hooks.onHit), true);
  });
});

describe('registry tables', () => {
  it('copies hot fields into typed columns indexed by id', () => {
    const { columns } = spells();

    assert.ok(columns.windup instanceof Float64Array);
    assert.ok(columns.cooldown instanceof Uint8Array);
    assert.deepEqual([...columns.windup], [0, 1.2, 0.4]);
    assert.deepEqual([...columns.cooldown], [8, 5, 1]);
  });

  it('builds a dispatch table and a has bitset per hook', () => {
    const registry = spells();

    assert.deepEqual(
      registry.hooks.onHit.map((hook) => typeof hook),
      ['function', 'undefined', 'function'],
    );
    assert.deepEqual(registry.has.onHit.toArray(), [0, 2]);
    assert.deepEqual(registry.has.release.toArray(), [1]);
    assert.equal(registry.has.release.has(registry.id.frostNova), false);
  });

  it('calls hooks detached, with no this', () => {
    const registry = spells();
    const { onHit } = registry.get(registry.id.frostNova);
    const tabled = registry.hooks.onHit[registry.id.spark];

    assert.equal(onHit?.(3, 4), 12);
    assert.equal(tabled?.(3, 0), 4);
  });

  it('refuses a hook field that holds data', () => {
    const bad: { onHit?: () => void } = {};

    Reflect.set(bad, 'onHit', 3);

    assert.throws(() => createRegistry({ bad }, { hooks: ['onHit'] }), TypeError);
  });
});

describe('registry order is append-only', () => {
  it('keeps a retired slot as a tombstone, so later ids do not move', () => {
    const registry = createRegistry(
      { a: { r: 1 }, old: TOMBSTONE, b: { r: 2 } },
      { columns: { r: { type: 'f32', of: (def) => def.r } } },
    );

    assert.equal(registry.id.b, 2);
    assert.equal(registry.isRetired(registry.id.old), true);
    assert.equal(registry.defs[1], undefined);
    assert.deepEqual(registry.ids, [0, 2]);
    assert.deepEqual([...registry.columns.r], [1, 0, 2]);
    assert.equal(registry.name(registry.id.old), 'old');
    assert.throws(() => registry.get(registry.id.old), RangeError);
  });

  it('takes a pinned order for a derived registry, whatever the key order', () => {
    const cooldowns = createRegistry(
      { second: { seconds: 2 }, first: { seconds: 1 } },
      { kind: 'cooldowns', order: ['first', 'gone', 'second'] },
    );

    assert.deepEqual(cooldowns.id, { second: 2, first: 0 });
    assert.equal(cooldowns.isRetired(cooldowns.id.first), false);
    assert.deepEqual(cooldowns.names, ['first', 'gone', 'second']);
    assert.equal(cooldowns.defs[1], undefined);
  });

  it('refuses a pinned order that leaves a definition out or lists a name twice', () => {
    assert.throws(() => createRegistry({ a: {}, b: {} }, { order: ['a'] }), RangeError);
    assert.throws(() => createRegistry({ a: {} }, { order: ['a', 'a'] }), RangeError);
  });

  it('checks a pinned order: appending passes, moving or removing fails', () => {
    const registry = spells();

    assert.doesNotThrow(() => {
      checkOrder(registry, ['frostNova', 'blast']);
    });
    assert.throws(() => {
      checkOrder(registry, ['blast', 'frostNova']);
    }, /Slot 0 was blast and is now frostNova/);
    assert.throws(() => {
      checkOrder(registry, ['frostNova', 'blast', 'spark', 'gone']);
    }, RangeError);
  });
});
