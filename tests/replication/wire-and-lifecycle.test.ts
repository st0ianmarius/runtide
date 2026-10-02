import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraView, ViewOptions } from '../../src/auras/index.ts';
import { type CueDef, defineCue, defineCues } from '../../src/cues/index.ts';
import { auraChanges, auraLifecycle, checkWireTable, wireTableOf } from '../../src/replication/index.ts';
import { aura, makeGame, TAGS } from '../helpers/aura-game.ts';

/** A bearer's aura views, in a fresh array. */
const viewsOf = <Bearer>(
  system: { readonly view: (bearer: Bearer, out: AuraView[], options?: ViewOptions) => number },
  bearer: Bearer,
  options?: ViewOptions
): AuraView[] => {
  const out: AuraView[] = [];

  return out.slice(0, system.view(bearer, out, options));
};

describe('wire tables', () => {
  it('pins a registry’s names by id with a checksum that changes with any name or order', () => {
    const { registry } = makeGame({ slow: aura({ duration: 1 }), fast: aura({ duration: 1 }) });
    const table = wireTableOf(registry);

    assert.deepEqual(table.names, ['slow', 'fast']);
    assert.equal(table.kind, 'auras');
    assert.match(table.checksum, /^[0-9a-f]{8}$/);
    assert.equal(
      wireTableOf({ kind: 'auras', names: ['slow', 'fast'] }).checksum,
      wireTableOf({ kind: 'auras', names: ['slow', 'fast'] }).checksum
    );
    assert.notEqual(wireTableOf({ kind: 'auras', names: ['fast', 'slow'] }).checksum, table.checksum);
    assert.notEqual(wireTableOf({ kind: 'cues', names: ['slow', 'fast'] }).checksum, table.checksum);
  });

  it('folds each aura’s rules and each cue’s schema into the checksum', () => {
    const auraSum = (fast: Parameters<typeof aura>[0]): string =>
      wireTableOf(makeGame({ slow: aura({ duration: 1 }), fast: aura(fast) }).registry).checksum;

    const cueSum = (hit: CueDef, positionScale?: number): string =>
      wireTableOf(
        defineCues({ hit, burst: defineCue({ anchor: 'world' }) }, positionScale === undefined ? {} : { positionScale })
      ).checksum;

    const plain: CueDef = defineCue({ anchor: 'self', params: { amount: { kind: 'uint8' } } });

    assert.equal(auraSum({ duration: 1 }), auraSum({ duration: 2 }));
    assert.equal(auraSum({ duration: 1 }), auraSum({ duration: 1, quiet: true }));
    assert.notEqual(auraSum({ duration: 1 }), auraSum({ duration: 1, predicted: true }));
    assert.notEqual(auraSum({ duration: 1 }), auraSum({ duration: 1, stacking: 'stack', maxStacks: 3 }));
    assert.equal(cueSum(plain), cueSum(defineCue({ anchor: 'self', params: { amount: { kind: 'uint8' } } })));
    assert.notEqual(cueSum(plain), cueSum(defineCue({ anchor: 'self', params: { amount: { kind: 'int' } } })));
    assert.notEqual(cueSum(plain), cueSum(defineCue({ anchor: 'entity', params: { amount: { kind: 'uint8' } } })));
    assert.notEqual(cueSum(plain), cueSum({ ...plain, isPredicted: true }));
    assert.notEqual(cueSum(plain), cueSum(plain, 10));
  });

  it('changes its checksum with a retirement or an entry’s signature, its names the same', () => {
    const plain = wireTableOf({ kind: 'cues', names: ['hit', 'burst'] }).checksum;

    assert.notEqual(
      wireTableOf({ kind: 'cues', names: ['hit', 'burst'], isRetired: (id) => id === 1 }).checksum,
      plain
    );
    assert.notEqual(
      wireTableOf({ kind: 'cues', names: ['hit', 'burst'], signature: (id) => (id === 0 ? 'size:u8' : '') }).checksum,
      plain
    );
    assert.equal(wireTableOf({ kind: 'cues', names: ['hit', 'burst'], signature: () => '' }).checksum, plain);
  });

  it('passes an append and refuses a move or a removal', () => {
    const table = wireTableOf({ kind: 'spells', names: ['bolt', 'nova', 'wave'] });

    assert.doesNotThrow(() => {
      checkWireTable(['bolt', 'nova'], table);
    });
    assert.throws(() => {
      checkWireTable(['nova', 'bolt'], table);
    }, /spells wire table is not append-only: nova \(id 0\) moved to id 1/);
    assert.throws(() => {
      checkWireTable(['bolt', 'nova', 'wave', 'mist'], table);
    }, /mist \(id 3\) is gone/);
  });
});

describe('aura lifecycle from views', () => {
  const { auras, id, unit, run } = makeGame({
    shield: aura({ duration: 1, stacking: 'stack', maxStacks: 3, value: 5 }),
    ward: aura({ duration: 2 }),
    mark: aura({ duration: 'infinite' })
  });

  it('tells an application, a refresh, a stack change, a value change, an expiry and a removal apart', () => {
    const u = unit();

    auras.apply(u, id.shield);
    auras.apply(u, id.ward);
    auras.apply(u, id.mark);

    const first = viewsOf(auras, u);

    run(u, 8);
    auras.apply(u, id.shield);
    auras.remove(u, id.mark);

    const second = viewsOf(auras, u);

    assert.deepEqual(auraChanges(first, second, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'refreshed' },
      { aura: id.mark, serial: 0, change: 'removed' }
    ]);

    run(u, 8);

    const third = viewsOf(auras, u);

    assert.deepEqual(auraChanges(second, third, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'expired' },
      { aura: id.ward, serial: 0, change: 'expired' }
    ]);
    assert.deepEqual(auraChanges([], second, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'applied' },
      { aura: id.ward, serial: 0, change: 'applied' }
    ]);
  });

  it('reads stacks first, then value, then a later end or a new duration, and an earlier end as nothing', () => {
    const u = unit();

    auras.apply(u, id.shield);

    const [base] = viewsOf(auras, u);

    assert.ok(base !== undefined);
    assert.equal(auraLifecycle(base, { ...base, stacks: 2 }, []), 'stacked');
    assert.equal(auraLifecycle(base, { ...base, stacks: 2, value: 1, end: base.end + 4 }, []), 'stacked');
    assert.equal(auraLifecycle(base, { ...base, value: 1 }, []), 'changed');
    assert.equal(auraLifecycle(base, { ...base, value: 1, end: base.end + 4 }, []), 'changed');
    assert.equal(auraLifecycle(base, { ...base, end: base.end + 4 }, []), 'refreshed');
    assert.equal(auraLifecycle(base, { ...base, duration: 2 }, []), 'refreshed');
    assert.equal(auraLifecycle(base, { ...base, duration: 2, end: base.end - 4 }, []), 'refreshed');
    assert.equal(auraLifecycle(base, { ...base, end: base.end - 4 }, []), undefined);
    assert.equal(auraLifecycle(base, base, []), undefined);
    assert.equal(auraLifecycle(undefined, undefined, []), undefined);
  });
});

describe('aura lifecycle from views, against the server’s events', () => {
  const { auras, id, unit, run, log } = makeGame({
    shield: aura({ duration: 1, stacking: 'stack', maxStacks: 3, onRefreshed: () => ['refreshed'] }),
    barrier: aura({ duration: 4, value: 5, onRefreshed: () => ['refreshed'] }),
    cooldown: aura({ duration: 4, tags: ['magic'], onRefreshed: () => ['refreshed'] })
  });

  /** The bearer's changes across `operate`, and the procs the server ran for it. */
  const across = (u: ReturnType<typeof unit>, operate: () => void): [unknown[], string[]] => {
    const before = viewsOf(auras, u, { for: 'owner' }).map((view) => ({ ...view }));
    const from = log.length;

    operate();

    const after = viewsOf(auras, u, { for: 'owner' }).map((view) => ({ ...view }));

    return [auraChanges(before, after, u.auras.clocks), log.slice(from)];
  };

  it('derives a stack gain under the stack rule, which also sets the clock again, as stacked', () => {
    const u = unit();

    auras.apply(u, id.shield);
    run(u, 2);
    assert.deepEqual(
      across(u, () => auras.apply(u, id.shield)),
      [[{ aura: id.shield, serial: 0, change: 'stacked' }], ['refreshed@1']]
    );
  });

  it('derives a partial spend of a value, which the server raises as a refresh, as changed', () => {
    const u = unit();

    auras.apply(u, id.barrier);
    run(u, 2);
    assert.deepEqual(
      across(u, () => auras.spendValue(u, id.barrier, 2)),
      [[{ aura: id.barrier, serial: 0, change: 'changed' }], ['refreshed@1']]
    );
  });

  it('derives nothing for a shortened time left, which the server raises nothing for', () => {
    const u = unit();

    auras.apply(u, id.cooldown);
    run(u, 2);
    assert.deepEqual(
      across(u, () => auras.scaleTimeLeft(u, TAGS.id.magic, 0.5)),
      [[], []]
    );
    assert.deepEqual(
      across(u, () => auras.clampTimeLeft(u, TAGS.id.magic, 1)),
      [[], []]
    );
    assert.deepEqual(
      across(u, () => auras.refresh(u, id.cooldown)),
      [[{ aura: id.cooldown, serial: 0, change: 'refreshed' }], ['refreshed@1']]
    );
  });
});
