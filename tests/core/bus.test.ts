import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBus } from '../../src/core/index.ts';

const gameBus = () =>
  createBus({
    hit: () => ({ target: 0, amount: 0 }),
    kill: () => ({ target: 0 }),
  });

describe('bus kinds and hearing', () => {
  it('numbers the kinds by key order', () => {
    const bus = gameBus();

    assert.deepEqual(bus.kind, { hit: 0, kill: 1 });
  });

  it('hears a kind only while something listens to it', () => {
    const bus = gameBus();

    assert.equal(bus.hears(bus.kind.hit), false);

    const stop = bus.on(bus.kind.hit, () => undefined);

    assert.equal(bus.hears(bus.kind.hit), true);
    assert.equal(bus.hears(bus.kind.kill), false);
    stop();
    stop();
    assert.equal(bus.hears(bus.kind.hit), false);
  });
});

describe('bus order and payloads', () => {
  it('runs capped handlers first, then subscribers in subscription order', () => {
    const bus = gameBus();
    const heard: string[] = [];

    bus.on(bus.kind.hit, ({ amount }) => heard.push(`first ${amount}`));
    bus.handle(bus.kind.hit, ({ amount }) => heard.push(`trigger ${amount}`));
    bus.on(bus.kind.hit, ({ amount }) => heard.push(`second ${amount}`));

    const payload = bus.payload(bus.kind.hit);

    payload.amount = 7;
    bus.raise(bus.kind.hit, payload);

    assert.deepEqual(heard, ['trigger 7', 'first 7', 'second 7']);
  });

  it('reuses one payload per kind per nesting level', () => {
    const bus = gameBus();
    const seen: object[] = [];

    bus.on(bus.kind.hit, (outer) => {
      seen.push(outer);

      if (outer.amount === 1) {
        const inner = bus.payload(bus.kind.hit);

        inner.amount = 2;
        bus.raise(bus.kind.hit, inner);
        assert.equal(outer.amount, 1);
      }
    });

    for (let i = 0; i < 2; i++) {
      const payload = bus.payload(bus.kind.hit);

      payload.amount = 1;
      bus.raise(bus.kind.hit, payload);
    }

    assert.equal(seen.length, 4);
    assert.equal(seen[0], seen[2]);
    assert.equal(seen[1], seen[3]);
    assert.notEqual(seen[0], seen[1]);
  });

  it('lets a listener unsubscribe while the kind is being raised', () => {
    const bus = gameBus();
    const heard: string[] = [];

    const stop = bus.on(bus.kind.kill, () => {
      heard.push('a');
      stop();
    });

    bus.on(bus.kind.kill, () => heard.push('b'));
    bus.raise(bus.kind.kill, bus.payload(bus.kind.kill));
    bus.raise(bus.kind.kill, bus.payload(bus.kind.kill));

    assert.deepEqual(heard, ['a', 'b', 'b']);
  });
});

describe('bus depth cap', () => {
  it('stops capped handlers at depth 3, while subscribers still hear every level', () => {
    const bus = gameBus();
    const handled: number[] = [];
    const subscribed: number[] = [];

    const raise = (amount: number): void => {
      const payload = bus.payload(bus.kind.hit);

      payload.amount = amount;
      bus.raise(bus.kind.hit, payload);
    };

    bus.handle(bus.kind.hit, ({ amount }) => {
      handled.push(amount);

      if (amount < 6) {
        raise(amount + 1);
      }
    });
    bus.on(bus.kind.hit, ({ amount }) => subscribed.push(amount));
    raise(1);

    assert.deepEqual(handled, [1, 2, 3]);
    assert.deepEqual(subscribed, [4, 3, 2, 1]);
    assert.equal(bus.depth, 0);
  });

  it('takes its own cap and restores the depth when a handler throws', () => {
    const bus = createBus({ ping: () => ({ n: 0 }) }, { maxDepth: 1 });

    bus.handle(bus.kind.ping, () => {
      assert.equal(bus.depth, 1);
      throw new Error('boom');
    });

    assert.throws(() => {
      bus.raise(bus.kind.ping, bus.payload(bus.kind.ping));
    }, /boom/);
    assert.equal(bus.depth, 0);
  });
});
