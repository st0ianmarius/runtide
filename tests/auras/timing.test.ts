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
  defineAuraTags,
} from '../../src/auras/index.ts';
import { createBus, defineCountdown } from '../../src/core/index.ts';
import { aura, makeGame, TAGS, type TestAuras } from '../helpers/aura-game.ts';

/** `max(0, t − dt)`, due only at zero. */
const PLAIN = defineCountdown({ snap: false, epsilon: 0 });

/** A step landing below `1e-8` lands on zero. */
const SNAPPED = defineCountdown({ snap: true, epsilon: 1e-8 });

/** A 1/60 s game over `defs` whose `world` clock keeps countdowns and whose `motion` clock stamps. */
const countingDown = <const Name extends string>(defs: Readonly<Record<Name, AuraDef>>) => {
  const registry = defineAuras(defs);

  const auras = createAuraSystem({
    registry,
    tags: defineAuraTags([]),

    clocks: {
      world: { dt: 1 / 60, countdown: PLAIN, timing: 'countdown' },
      motion: { dt: 1 / 60, countdown: SNAPPED },
    },
  });

  const bearer = (): AuraBearer => ({ auras: auras.createState() });

  return { auras, id: registry.id, bearer };
};

describe('clocks that keep countdowns', () => {
  it('count the seconds left down by the rule every tick, and read what is left in seconds', () => {
    const { auras, id, bearer } = countingDown({ grace: defineAura({ duration: 2, stacking: 'extend' }) });
    const b = bearer();

    auras.apply(b, id.grace);

    for (let i = 0; i < 30; i++) {
      auras.tick(b, 'world');
    }

    auras.apply(b, id.grace);
    assert.equal(auras.remaining(b, id.grace), 3.5000000000000018, 'the float a hand-written countdown holds');
    assert.equal(auras.find(b, id.grace)?.duration, 3.5000000000000018);
    assert.equal(auras.find(b, id.grace)?.end, -1, 'no stamp');
  });

  it('run out on the tick the countdown reaches zero, a sliver included', () => {
    const { auras, id, bearer } = countingDown({ ward: defineAura({ duration: 3 }) });
    const b = bearer();

    auras.apply(b, id.ward);

    for (let i = 0; i < 180; i++) {
      auras.tick(b, 'world');
    }

    assert.equal(auras.has(b, id.ward), true);
    assert.equal(auras.remaining(b, id.ward) > 0, true, 'a sliver left by max(0, t − dt)');
    auras.tick(b, 'world');
    assert.equal(auras.has(b, id.ward), false);
  });

  it('compare a highest in seconds, so a later length on the same tick still wins', () => {
    const { auras, id, bearer } = countingDown({ chill: defineAura({ duration: 1, stacking: 'highest' }) });
    const b = bearer();

    auras.apply(b, id.chill);
    auras.tick(b, 'world');
    assert.equal(auras.apply(b, { aura: id.chill, duration: 1 - 1 / 60 + 1e-12 }).changed, true);
    assert.equal(auras.apply(b, { aura: id.chill, duration: 0.5 }).changed, false);
  });

  it('run out a zero-length aura on the next tick of any clock', () => {
    const { auras, id, bearer } = countingDown({ flash: defineAura({ duration: 0 }) });
    const b = bearer();

    auras.apply(b, id.flash);
    auras.tick(b, 'motion');
    assert.equal(auras.has(b, id.flash), false);
  });
});

describe('countdown rules as extension points', () => {
  it('let a beat take a rule of its own, so float drift does not cost it a tick', () => {
    const ticks: [string, number][] = [];

    const beat = (name: string) => ({
      every: 3,

      onBeat: (ctx: { readonly bearer: AuraBearer }) => {
        ticks.push([name, ctx.bearer.auras.clocks[0] ?? 0]);

        return undefined;
      },
    });

    const { auras, id, bearer } = countingDown({
      plain: defineAura({ duration: 'infinite', periodic: beat('plain') }),
      tolerant: defineAura({ duration: 'infinite', periodic: { ...beat('tolerant'), countdown: SNAPPED } }),
    });

    const b = bearer();

    auras.apply(b, id.plain);
    auras.apply(b, id.tolerant);

    for (let i = 0; i < 181; i++) {
      auras.tick(b, 'world');
    }

    assert.deepEqual(ticks, [
      ['tolerant', 180],
      ['plain', 181],
    ]);
  });

  it('let one bearer count a clock by another rule (a prediction copy)', () => {
    const registry = defineAuras({ ward: defineAura({ duration: 3 }) });

    const auras = createAuraSystem({
      registry,
      tags: defineAuraTags([]),
      clocks: { world: { dt: 1 / 60, countdown: PLAIN } },
    });

    const real: AuraBearer = { auras: auras.createState() };
    const copy: AuraBearer = { auras: auras.createState({ isSilent: true, countdowns: { world: SNAPPED } }) };

    auras.apply(real, registry.id.ward);
    auras.apply(copy, registry.id.ward);
    assert.deepEqual([auras.find(real, registry.id.ward)?.end, auras.find(copy, registry.id.ward)?.end], [181, 180]);
  });
});

describe('causes and operations', () => {
  it('tell every change why it happened, and which call made it', () => {
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
          },
        }),
      },
      { events: { bus, kind: bus.kind.aura } },
    );

    const u = unit();

    bus.on(bus.kind.aura, (event: AuraEvent<TestAuras>) => {
      heard.push(`${event.op}:${event.change}:${event.cause}`);
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
      '1:applied:apply',
      '2:applied:apply',
      '3:removed:evict',
      '3:applied:apply',
      '4:removed:remove',
      '4:removed:remove',
      '5:applied:apply',
      '6:removed:cleanse',
      '6:applied:apply',
      '7:applied:apply',
      '8:removed:spendStacks',
      '9:applied:apply',
      '11:expired:tick',
      '12:applied:apply',
      '13:removed:remove',
    ]);
    assert.deepEqual(causes, ['tick', 'remove']);
  });
});
