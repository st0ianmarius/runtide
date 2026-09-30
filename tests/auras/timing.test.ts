import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AuraBearer,
  type AuraDef,
  type AuraEvent,
  createAuraEvent,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags
} from '../../src/auras/index.ts';
import { createBus } from '../../src/core/index.ts';
import { aura, makeGame, TAGS, type TestAuras } from '../helpers/aura-game.ts';

describe('aura lengths in whole steps', () => {
  /** A 1/60 s game over `defs`, with a `world` clock and a `motion` clock. */
  const game = <const Name extends string>(defs: Readonly<Record<Name, AuraDef>>) => {
    const registry = defineAuras(defs);

    const auras = createAuraSystem({
      registry,
      tags: defineAuraTags([]),
      clocks: { world: { dt: 1 / 60 }, motion: { dt: 1 / 60 } }
    });

    return { auras, id: registry.id, bearer: (): AuraBearer => ({ auras: auras.createState() }) };
  };

  it('run out on the step their seconds say, with no sliver for one more', () => {
    const { auras, id, bearer } = game({
      ward: defineAura({ duration: 3 }),
      jolt: defineAura({ duration: 0.1 })
    });

    const b = bearer();

    auras.apply(b, id.ward);
    auras.apply(b, id.jolt);
    assert.deepEqual([auras.find(b, id.ward)?.end, auras.find(b, id.jolt)?.end], [180, 6]);

    for (let i = 0; i < 179; i++) {
      auras.tick(b, 'world');
    }

    assert.equal(auras.remaining(b, id.ward), 1 / 60);
    auras.tick(b, 'world');
    assert.deepEqual([auras.has(b, id.ward), auras.has(b, id.jolt)], [false, false]);
  });

  it('extend and compare a highest in whole steps', () => {
    const { auras, id, bearer } = game({
      grace: defineAura({ duration: 2, stacking: 'extend' }),
      chill: defineAura({ duration: 1, stacking: 'highest' })
    });

    const b = bearer();

    auras.apply(b, id.grace);
    auras.apply(b, id.chill);

    for (let i = 0; i < 30; i++) {
      auras.tick(b, 'world');
    }

    auras.apply(b, id.grace);
    assert.equal(auras.find(b, id.grace)?.end, 240);
    assert.equal(auras.remaining(b, id.grace), 3.5);
    assert.equal(auras.apply(b, { aura: id.chill, duration: 0.5 + 1 / 60 }).changed, true);
    assert.equal(auras.apply(b, { aura: id.chill, duration: 0.5 }).changed, false);
  });

  it('run out a zero-length aura on the next tick of any clock', () => {
    const { auras, id, bearer } = game({ flash: defineAura({ duration: 0 }) });
    const b = bearer();

    auras.apply(b, id.flash);
    auras.tick(b, 'motion');
    assert.equal(auras.has(b, id.flash), false);
  });
});

describe('causes and operations', () => {
  it('tell every change why it happened', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const heard: string[] = [];
    const causes: string[] = [];

    const { auras, id, unit, run } = makeGame(
      {
        echo: aura({ duration: 1, stacking: 'independent', maxStacks: 2, tags: ['magic'] }),
        purge: aura({ duration: 1, removes: ['magic'] }),
        rend: aura({ duration: 5, stacking: 'stack', maxStacks: 3 }),

        watched: aura({
          duration: 0.125,

          onRemoved: (ctx) => {
            causes.push(ctx.cause);

            return undefined;
          },

          onExpired: (ctx) => {
            causes.push(ctx.cause);

            return undefined;
          }
        })
      },
      { events: { bus, changed: bus.kind.aura } }
    );

    const u = unit();

    bus.on(bus.kind.aura, (event: AuraEvent<TestAuras>) => {
      heard.push(`${event.change}:${event.cause}`);
    });

    auras.apply(u, id.echo);
    auras.apply(u, id.echo);
    auras.apply(u, id.echo);
    auras.remove(u, id.echo);
    auras.apply(u, id.echo);
    auras.apply(u, id.purge);
    auras.apply(u, { aura: id.rend, stacks: 2 });
    auras.spendStacks(u, id.rend, 2);
    auras.apply(u, id.watched);
    auras.removeByTag(u, TAGS.id.stun);
    run(u, 1);
    auras.apply(u, id.watched);
    auras.remove(u, id.watched);

    assert.deepEqual(heard, [
      'applied:apply',
      'applied:apply',
      'removed:evict',
      'applied:apply',
      'removed:remove',
      'removed:remove',
      'applied:apply',
      'removed:cleanse',
      'applied:apply',
      'applied:apply',
      'removed:spendStacks',
      'applied:apply',
      'expired:tick',
      'applied:apply',
      'removed:remove'
    ]);
    assert.deepEqual(causes, ['tick', 'remove']);
  });
});
