import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ActiveAura,
  auraGates,
  auraStacks,
  type ClockRescale,
  createAuraSystem,
  defineAuras,
} from '../../src/auras/index.ts';
import { createModifierSystem, defineSources, defineStats, mul } from '../../src/modifiers/index.ts';
import { aura, CLOCKS, makeGame, TAGS, type TestAuras, type Unit } from '../helpers/aura-game.ts';

describe('game fields and landing', () => {
  it('capture an application payload into the aura own fields on every landing, and clear them on release', () => {
    const { auras, id, unit } = makeGame({
      brand: aura({
        duration: 4,

        onLand: (ctx, application) => {
          ctx.aura.ext.snapshot = Math.max(ctx.aura.ext.snapshot, application.payload ?? 0);
        },
      }),
    });

    const u = unit();

    auras.apply(u, { aura: id.brand, payload: 30 });
    auras.apply(u, { aura: id.brand, payload: 12 });
    assert.equal(auras.find(u, id.brand)?.ext.snapshot, 30);
    auras.remove(u, id.brand);
    auras.apply(u, id.brand);
    assert.equal(auras.find(u, id.brand)?.ext.snapshot, 0, 'the reused slot came back cleared');
  });

  it('hand hooks the bearer stats the host reports', () => {
    const seen: number[] = [];
    const table = defineStats({ armor: { base: 0, kind: 'flat' } });
    const stats = { total: (): number => 42, base: (): number => 1 };

    const { auras, id, unit } = makeGame(
      {
        haste: aura({
          duration: 4,

          onApplied: (ctx) => {
            seen.push(ctx.stats?.total(table.id.armor) ?? 0);

            return undefined;
          },
        }),
      },
      { host: { statsOf: () => stats } },
    );

    auras.apply(unit(), id.haste);
    assert.deepEqual(seen, [42]);
  });
});

describe('damage hook declarations', () => {
  it('are collected in list order for a pipeline, which calls them with a context', () => {
    const { auras, id, unit } = makeGame({
      shield: aura({
        duration: 10,
        value: 50,
        onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow) }),
      }),

      plain: aura({ duration: 10 }),
      guard: aura({ duration: 10, onIncomingDamage: () => ({ scale: 0.5 }), onIgnore: (_ctx, blow) => blow < 1 }),
      escape: aura({ duration: 10, onLethal: () => ({ prevent: true, procs: ['heal'] }) }),
    });

    const u = unit();
    const out: (ActiveAura<TestAuras> | undefined)[] = [];

    for (const name of ['escape', 'plain', 'guard', 'shield'] as const) {
      auras.apply(u, id[name]);
    }

    assert.equal(auras.collect(u, 'onIncomingDamage', out), 2);
    assert.deepEqual(
      out.map((a) => a?.id),
      [id.shield, id.guard],
    );
    assert.deepEqual(
      out.map((a) =>
        a === undefined ? undefined : auras.registry.get(a.id).onIncomingDamage?.(auras.context(u, a), 80),
      ),
      [{ absorb: 50 }, { scale: 0.5 }],
    );
    assert.equal(auras.collect(u, 'onLethal', out), 1);
    assert.deepEqual(
      out.map((a) => a?.id),
      [id.escape, undefined],
    );
    assert.equal(auras.registry.has.onIgnore.has(id.guard), true);
  });
});

describe('clock rescales on aura edges', () => {
  it('hand the host the aura own multiplier: divided on applied and refreshed, multiplied back as it ends', () => {
    const rescales: ClockRescale[] = [];

    const stats = defineStats({
      damage: { base: 1, kind: 'multiplier' },
      armor: { base: 0, kind: 'flat' },
      speed: { base: 1, kind: 'multiplier' },
    });

    const modifiers = createModifierSystem({
      stats,
      sources: defineSources(['base', 'auras', 'late']),
      stacks: auraStacks,
      held: auraGates,
    });

    const registry = defineAuras({
      overdrive: aura({
        duration: 1,
        stacking: 'stack',
        maxStacks: 2,
        modifiers: [mul('speed', 1.25), mul('damage', 3)],
        rescale: { stat: 'speed', on: ['applied', 'refreshed', 'expired', 'removed'], tag: 4 },
      }),
    });

    const auras = createAuraSystem<TestAuras>({
      registry,
      tags: TAGS,
      clocks: CLOCKS,
      modifiers,
      fold: 'auras',
      createExt: () => ({ snapshot: 0 }),

      host: {
        rescaleClocks: (_bearer, rescale) => {
          rescales.push(rescale);
        },
      },
    });

    const u: Unit = { id: 1, hp: 1, auras: auras.createState() };

    auras.apply(u, registry.id.overdrive);
    auras.apply(u, registry.id.overdrive);

    for (let i = 0; i < 8; i++) {
      auras.tick(u, 'world');
    }

    assert.deepEqual(
      rescales.map((r) => r.factor),
      [0.8, 0.64, 1.5625],
    );
    assert.deepEqual(rescales[0], {
      aura: registry.id.overdrive,
      stat: stats.id.speed,
      factor: 0.8,
      tag: 4,
      clocks: 'pending',
    });
  });
});
