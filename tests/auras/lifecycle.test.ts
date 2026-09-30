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
    onState: (_ctx: unknown, state: string) => [`${state}:${name}`],
  }) as const;

const defs = {
  renew: aura({ duration: 4, ...logged('renew') }),
  chill: aura({ duration: 2, stacking: 'highest', ...logged('chill') }),
  rend: aura({ duration: 5, stacking: 'stack', maxStacks: 3, ...logged('rend') }),
  ward: aura({ duration: 6, tags: ['immune'], ...logged('ward') }),
  scald: aura({ duration: 3, tags: ['poison'], blockedBy: ['immune'], ...logged('scald') }),
  purge: aura({ duration: 1, removes: ['poison'], ...logged('purge') }),
  echo: aura({ duration: 3, stacking: 'independent', maxStacks: 2, ...logged('echo') }),
  gift: aura({ duration: 1, grants: ['reroll', 'gold'], ...logged('gift') }),
};

describe('lifecycle hooks and their raise rules (§II.6 A1)', () => {
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
      'applied:ward@1',
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
      'applied:echo@1',
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

  it('run grants on every application that lands, before its lifecycle events', () => {
    const { auras, id, unit, log } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.gift);
    auras.apply(u, id.gift);
    assert.deepEqual(log, ['reroll@1', 'gold@1', 'applied:gift@1', 'reroll@1', 'gold@1', 'refreshed:gift@1']);
  });

  it('hand the hook an aura already off its bearer for expired and removed', () => {
    const seen: [boolean, number][] = [];

    const { auras, id, unit, run } = makeGame({
      brief: aura({
        duration: 0.125,

        onExpired: (ctx) => {
          seen.push([ctx.aura.isActive, ctx.bearer.auras.list.length]);

          return undefined;
        },
      }),
    });

    const u = unit();

    auras.apply(u, id.brief);
    run(u, 1);
    assert.deepEqual(seen, [[false, 0]]);
  });

  it('runs no hook and raises nothing on a silent bearer (a preview or a prediction copy)', () => {
    const { auras, id, unit, run, log } = makeGame(defs);
    const u = unit(1, true);

    auras.apply(u, id.gift);
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

        onExpired: (ctx): readonly string[] => [
          auras.apply(ctx.bearer, registry.id.third).fresh ? 'nested' : 'refused',
        ],
      }),

      second: aura({ duration: 0.125, ...logged('second') }),
      third: aura({ duration: 5, ...logged('third') }),
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
      'subscriber:removed:0@1|2',
    ]);
  });

  it('are not filled when nothing listens', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const { auras, id, unit } = makeGame(defs, { events: { bus, changed: bus.kind.aura } });
    const u = unit();

    auras.apply(u, id.renew);
    assert.equal(bus.payload(bus.kind.aura).bearer, undefined);
  });
});
