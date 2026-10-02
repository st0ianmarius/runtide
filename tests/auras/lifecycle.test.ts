import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AuraEvent, createAuraEvent } from '../../src/auras/index.ts';
import { createBus } from '../../src/core/index.ts';
import { aura, makeGame, TAGS, type TestAuras } from '../helpers/aura-game.ts';

/** Hooks that log every lifecycle change of an aura as a proc named `change:name`. */
const logged = (name: string) =>
  ({
    onApplied: () => [`applied:${name}`],
    onRefreshed: () => [`refreshed:${name}`],
    onExpired: () => [`expired:${name}`],
    onRemoved: () => [`removed:${name}`],
    onState: (_ctx: unknown, state: string) => [`${state}:${name}`]
  }) as const;

const defs = {
  renew: aura({ duration: 4, ...logged('renew') }),
  chill: aura({ duration: 2, stacking: 'highest', ...logged('chill') }),
  rend: aura({ duration: 5, stacking: 'stack', maxStacks: 3, ...logged('rend') }),
  ward: aura({ duration: 6, tags: ['immune'], ...logged('ward') }),
  scald: aura({ duration: 3, tags: ['poison'], blockedBy: ['immune'], ...logged('scald') }),
  purge: aura({ duration: 1, removes: ['poison'], ...logged('purge') }),
  echo: aura({ duration: 3, stacking: 'independent', maxStacks: 2, ...logged('echo') })
};

describe('lifecycle hooks and their raise rules', () => {
  it('raise applied, refreshed, nothing for a losing highest, nothing for a refusal', () => {
    const { auras, id, unit, log } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.renew);
    auras.apply(u, { aura: id.renew, duration: 1 });
    auras.apply(u, id.chill);
    auras.apply(u, { aura: id.chill, duration: 1 });
    auras.apply(u, { aura: id.chill, duration: 3 });
    auras.apply(u, id.rend);
    auras.apply(u, { aura: id.rend, stacks: 5 });
    auras.apply(u, id.ward);
    auras.apply(u, id.scald);
    assert.deepEqual(log, [
      'applied:renew@1',
      'refreshed:renew@1',
      'applied:chill@1',
      'refreshed:chill@1',
      'applied:rend@1',
      'refreshed:rend@1',
      'applied:ward@1'
    ]);
  });

  it('raise removed for removal, a cleanse (before the application that cleansed), a spend and an eviction', () => {
    const { auras, id, unit, log } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.renew);
    auras.remove(u, id.renew);
    auras.remove(u, id.renew);
    auras.apply(u, id.scald);
    auras.apply(u, id.purge);
    auras.apply(u, { aura: id.rend, stacks: 3 });
    auras.spendStacks(u, id.rend, 2);
    auras.spendStacks(u, id.rend, 1);
    auras.apply(u, { aura: id.echo, duration: 1 });
    auras.apply(u, { aura: id.echo, duration: 2 });
    auras.apply(u, { aura: id.echo, duration: 3 });
    assert.deepEqual(log, [
      'applied:renew@1',
      'removed:renew@1',
      'applied:scald@1',
      'removed:scald@1',
      'applied:purge@1',
      'applied:rend@1',
      'refreshed:rend@1',
      'removed:rend@1',
      'applied:echo@1',
      'applied:echo@1',
      'removed:echo@1',
      'applied:echo@1'
    ]);
  });

  it('raise nothing as a bearer gone for good releases its auras, whose slots go back to the pool', () => {
    const { auras, id, unit, log } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.renew);
    auras.apply(u, id.ward);
    assert.equal(auras.release(u), 2);
    assert.deepEqual(log, ['applied:renew@1', 'applied:ward@1']);
    assert.deepEqual([auras.list(u).length, auras.hasTag(u, TAGS.id.immune), auras.pool.live], [0, false, 0]);
  });

  it('tell removal watchers of each aura that comes off, but not of a gone bearer’s released ones', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();
    const heard: number[] = [];

    auras.watchRemovals((bearer, aura) => {
      assert.equal(bearer, u);
      heard.push(aura);
    });
    auras.apply(u, id.renew);
    auras.remove(u, id.renew);
    auras.apply(u, id.chill);
    run(u, 17); // chill's 2 s, on steps of 1/8 s
    auras.apply(u, id.scald);
    auras.apply(u, id.purge);
    auras.apply(u, id.ward);
    auras.release(u);
    assert.deepEqual(heard, [id.renew, id.chill, id.scald]);
  });

  it('raise expired once, in list order after the whole list has counted, and a state entered without removing', () => {
    const { auras, id, unit, run, log } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.echo, duration: 0.125 });
    auras.apply(u, { aura: id.renew, duration: 0.125 });
    run(u, 1);
    auras.apply(u, id.ward);
    auras.enterState(u, 'down');
    assert.deepEqual(log.slice(2), ['expired:renew@1', 'expired:echo@1', 'applied:ward@1', 'down:ward@1']);
    assert.equal(auras.has(u, id.ward), true);
    run(u, 100);
    assert.equal(log.filter((line) => line.startsWith('expired')).length, 3);
  });

  it('hand the hook an aura already off its bearer for expired and removed', () => {
    const seen: [boolean, number][] = [];

    const { auras, id, unit, run } = makeGame({
      brief: aura({
        duration: 0.125,

        onExpired: (ctx) => {
          seen.push([ctx.aura.isActive, ctx.bearer.auras.list.length]);

          return undefined;
        }
      })
    });

    const u = unit();

    auras.apply(u, id.brief);
    run(u, 1);
    assert.deepEqual(seen, [[false, 0]]);
  });

  it('runs no hook and raises nothing on a silent bearer (a preview or a prediction copy)', () => {
    const { auras, id, unit, run, log } = makeGame(defs);
    const u = unit(1, true);

    auras.apply(u, id.renew);
    auras.remove(u, id.renew);
    run(u, 100);
    assert.deepEqual(log, []);
    assert.equal(u.auras.list.length, 0);
  });

  it('dispatch a hook that changes auras nested, before the outer operation moves on', () => {
    const { auras, unit, run, log, registry } = makeGame({
      first: aura({
        duration: 0.125,

        onExpired: (ctx): readonly string[] => [auras.apply(ctx.bearer, registry.id.third).fresh ? 'nested' : 'refused']
      }),

      second: aura({ duration: 0.125, ...logged('second') }),
      third: aura({ duration: 5, ...logged('third') })
    });

    const u = unit();

    auras.apply(u, registry.id.first);
    auras.apply(u, registry.id.second);
    run(u, 1);
    assert.deepEqual(log, ['applied:second@1', 'applied:third@1', 'nested@1', 'expired:second@1']);
  });
});

describe('aura events on the bus', () => {
  it('reach capped handlers (the triggers) and then subscribers, after the hook', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const heard: string[] = [];
    const { auras, id, unit, log } = makeGame(defs, { events: { bus, changed: bus.kind.aura } });
    const u = unit();

    const note = (tier: string) => (event: AuraEvent<TestAuras>) => {
      heard.push(`${tier}:${event.change}:${event.aura?.id}@${event.bearer?.id}|${log.length}`);
    };

    bus.handle(bus.kind.aura, note('trigger'));
    bus.on(bus.kind.aura, note('subscriber'));
    auras.apply(u, id.renew);
    auras.remove(u, id.renew);
    assert.deepEqual(heard, [
      'trigger:applied:0@1|1',
      'subscriber:applied:0@1|1',
      'trigger:removed:0@1|2',
      'subscriber:removed:0@1|2'
    ]);
  });

  it('are never raised for a quiet aura, whose hooks still run', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const heard: string[] = [];

    const { auras, id, unit, log } = makeGame(
      { hush: aura({ duration: 4, quiet: true, ...logged('hush') }) },
      { events: { bus, changed: bus.kind.aura } }
    );

    const u = unit();

    bus.on(bus.kind.aura, (event) => heard.push(event.change ?? '?'));
    auras.apply(u, id.hush);
    auras.remove(u, id.hush);
    assert.deepEqual([heard, log.length], [[], 2]);
  });

  it('are not filled when nothing listens', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const { auras, id, unit } = makeGame(defs, { events: { bus, changed: bus.kind.aura } });
    const u = unit();

    auras.apply(u, id.renew);
    assert.equal(bus.payload(bus.kind.aura).bearer, undefined);
  });

  it('carry a dispel’s cause and dispeller, which the removed aura’s onRemoved reads too', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const heard: string[] = [];
    const removers: number[] = [];

    const { auras, unit, id } = makeGame(
      {
        curse: aura({
          duration: 9,
          tags: ['magic'],
          onRemoved: (ctx) => void removers.push(ctx.remover)
        }),
        hex: aura({ duration: 9, tags: ['magic'] }),
        blight: aura({ duration: 9, tags: ['magic'], value: 3 }),
        ward: aura({ duration: 9, tags: ['boon'] })
      },
      { events: { bus, changed: bus.kind.aura } }
    );

    const u = unit();

    bus.on(bus.kind.aura, (event) => {
      if (event.change === 'removed') {
        heard.push(`${event.cause} ${event.aura?.id} by ${event.remover}`);
      }
    });

    for (const each of [id.curse, id.hex, id.blight, id.ward]) {
      auras.apply(u, each);
    }

    assert.equal(
      auras.dispel(u, {
        tag: TAGS.id.magic,
        limit: 2,
        filter: (active) => active.value === 0,
        by: 7
      }),
      2
    );
    assert.deepEqual(heard, ['dispel 0 by 7', 'dispel 1 by 7']);
    assert.deepEqual(removers, [7]);
    assert.equal(auras.dispel(u, { tag: TAGS.id.magic }), 1);
    assert.throws(() => auras.dispel(u, { tag: TAGS.id.magic, limit: -1, by: 77 }), /limit from 0/);

    // The refused dispel opened nothing: a context taken outside any operation reads no dispel.
    const context = auras.takeContext(u, auras.find(u, id.ward) ?? assert.fail('ward'));

    assert.deepEqual([context.cause, context.remover === 77], ['apply', false]);
    auras.giveContext();
  });
});

describe('hooks that throw', () => {
  for (const spend of ['spendStacks', 'spendValue'] as const) {
    it(`closes ${spend} when a removal watcher throws, releasing slots and refreshing tags`, () => {
      const { auras, id, unit, log } = makeGame({
        ward: aura({ duration: 'infinite', tags: ['immune'], value: 1, ...logged('ward') })
      });

      const u = unit();
      const error = new Error('watcher');
      let throws = true;

      auras.watchRemovals(() => {
        if (throws) {
          throw error;
        }
      });
      auras.apply(u, id.ward);
      assert.throws(
        () => auras[spend](u, id.ward, 1),
        (caught) => caught === error
      );
      assert.deepEqual([auras.list(u).length, auras.hasTag(u, TAGS.id.immune), auras.pool.live], [0, false, 0]);
      assert.deepEqual(log, ['applied:ward@1', 'removed:ward@1']);

      // Later operations must release their slots too, with no stale events left queued.
      throws = false;
      auras.apply(u, id.ward);
      auras.remove(u, id.ward);
      assert.equal(auras.pool.live, 0);
      assert.deepEqual(log, ['applied:ward@1', 'removed:ward@1', 'applied:ward@1', 'removed:ward@1']);
    });
  }

  it('still dispatch the rest of the operation’s events, then throw', () => {
    const { auras, id, unit, log } = makeGame({
      first: aura({
        duration: 'infinite',
        tags: ['magic'],

        onRemoved: () => {
          throw new Error('first');
        }
      }),
      second: aura({ duration: 'infinite', tags: ['magic'], onRemoved: () => ['teardown:second'] })
    });

    const u = unit();

    auras.apply(u, id.first);
    auras.apply(u, id.second);
    assert.throws(() => auras.removeByTag(u, TAGS.id.magic), /first/);
    assert.deepEqual(log, ['teardown:second@1']);
    assert.deepEqual([auras.list(u).length, auras.pool.live], [0, 0]);
  });

  it('still raise applied for an aura whose onLand throws, so its setup pairs with its teardown', () => {
    const { auras, id, unit, log } = makeGame({
      brand: aura({
        duration: 5,
        tags: ['stun'],
        ...logged('brand'),

        onLand: () => {
          throw new Error('brand');
        }
      })
    });

    const u = unit();

    assert.throws(() => auras.apply(u, id.brand), /brand/);
    assert.deepEqual([auras.has(u, id.brand), auras.hasTag(u, TAGS.id.stun)], [true, true]);
    auras.remove(u, id.brand);
    assert.deepEqual(log, ['applied:brand@1', 'removed:brand@1']);
  });

  it('refuse a first live period that is not above 0, as every later one, the aura landed and applied raised', () => {
    const { auras, id, unit, log } = makeGame({
      dot: aura({ duration: 5, ...logged('dot'), periodic: { every: () => Number.NaN, onBeat: () => ['beat'] } })
    });

    const u = unit();

    assert.throws(() => auras.apply(u, id.dot), /dot: a live period must be more than 0; got NaN/);
    assert.deepEqual(log, ['applied:dot@1']);
    assert.equal(auras.has(u, id.dot), true);
  });

  it('still have every aura hear a state and the state’s auras go, then throw', () => {
    const { auras, id, unit, log } = makeGame({
      bomb: aura({
        duration: 'infinite',
        removedOn: ['dead'],

        onState: () => {
          throw new Error('bomb');
        }
      }),
      shield: aura({ duration: 'infinite', removedOn: ['dead'], ...logged('shield') }),
      mark: aura({ duration: 'infinite', ...logged('mark') })
    });

    const u = unit();

    auras.apply(u, id.bomb);
    auras.apply(u, id.shield);
    auras.apply(u, id.mark);
    log.length = 0;
    assert.throws(() => auras.enterState(u, 'dead'), /bomb/);
    assert.deepEqual(log, ['dead:shield@1', 'dead:mark@1', 'removed:shield@1']);
    assert.deepEqual(
      auras.list(u).map((a) => a.id),
      [id.mark]
    );
  });
});

describe('slots of removed auras', () => {
  it('stay theirs until their removed events ran, though the cleansing aura’s onLand or stacking rule ran first', () => {
    const seen: string[] = [];
    const late: { apply?: (bearer: object, name: 'mark' | 'other') => void } = {};

    const { auras, id, unit } = makeGame({
      venom: aura({
        duration: 10,
        tags: ['poison'],

        onLand: (ctx) => {
          ctx.aura.ext.snapshot = 42;
        },

        onRemoved: (ctx) => {
          seen.push(`venom ${ctx.aura.ext.snapshot}`);
          late.apply?.(ctx.bearer, 'mark');
          late.apply?.(ctx.bearer, 'other');
        }
      }),
      sting: aura({ duration: 10, tags: ['poison'], onRemoved: () => void seen.push('sting') }),
      mark: aura({ duration: 10, onRemoved: () => void seen.push('mark') }),
      other: aura({ duration: 10, onRemoved: () => void seen.push('other') }),
      antidote: aura({ duration: 5, removes: ['poison'], onLand: () => undefined }),

      tonic: aura({
        duration: 5,
        removes: ['poison'],

        stacking: (ctx) => {
          late.apply?.(ctx.bearer, 'mark');
        }
      })
    });

    const u = unit();

    late.apply = (bearer, name) => {
      if (bearer === u) {
        auras.apply(u, id[name]);
      }
    };

    for (const cure of [id.antidote, id.tonic]) {
      auras.apply(u, id.tonic);
      auras.apply(u, id.venom);
      auras.apply(u, id.sting);
      auras.apply(u, cure);
    }

    assert.deepEqual(seen, ['venom 42', 'sting', 'venom 42', 'sting']);
    assert.deepEqual([auras.has(u, id.mark), auras.has(u, id.other)], [true, true]);
  });
});
