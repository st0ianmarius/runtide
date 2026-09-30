import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auraChanges, auraLifecycle, checkWireTable, wireTableOf } from '../../src/replication/index.ts';
import { aura, makeGame } from '../helpers/aura-game.ts';

describe('wire tables', () => {
  it('pins a registry’s names by id with a checksum that changes with any name or order', () => {
    const { registry } = makeGame({ slow: aura({ duration: 1 }), fast: aura({ duration: 1 }) });
    const table = wireTableOf(registry);

    assert.deepEqual(table.names, ['slow', 'fast']);
    assert.equal(table.kind, 'auras');
    assert.match(table.checksum, /^[0-9a-f]{8}$/);
    assert.equal(wireTableOf({ kind: 'auras', names: ['slow', 'fast'] }).checksum, table.checksum);
    assert.notEqual(wireTableOf({ kind: 'auras', names: ['fast', 'slow'] }).checksum, table.checksum);
    assert.notEqual(wireTableOf({ kind: 'cues', names: ['slow', 'fast'] }).checksum, table.checksum);
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
    mark: aura({ duration: 'infinite' }),
  });

  it('tells an application, a refresh, a stack change, a value change, an expiry and a removal apart', () => {
    const u = unit();

    auras.apply(u, id.shield);
    auras.apply(u, id.ward);
    auras.apply(u, id.mark);

    const first = auras.view(u);

    run(u, 8);
    auras.apply(u, id.shield);
    auras.remove(u, id.mark);

    const second = auras.view(u);

    assert.deepEqual(auraChanges(first, second, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'refreshed' },
      { aura: id.mark, serial: 0, change: 'removed' },
    ]);

    run(u, 8);

    const third = auras.view(u);

    assert.deepEqual(auraChanges(second, third, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'expired' },
      { aura: id.ward, serial: 0, change: 'expired' },
    ]);
    assert.deepEqual(auraChanges([], second, u.auras.clocks), [
      { aura: id.shield, serial: 0, change: 'applied' },
      { aura: id.ward, serial: 0, change: 'applied' },
    ]);
  });

  it('reads stacks and value changes when the clock was not set again', () => {
    const u = unit();

    auras.apply(u, id.shield);

    const [base] = auras.view(u);

    assert.ok(base !== undefined);
    assert.equal(auraLifecycle(base, { ...base, stacks: 2 }, []), 'stacked');
    assert.equal(auraLifecycle(base, { ...base, value: 1 }, []), 'changed');
    assert.equal(auraLifecycle(base, base, []), undefined);
    assert.equal(auraLifecycle(undefined, undefined, []), undefined);
  });
});
