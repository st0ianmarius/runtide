import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ActiveAura } from '../../src/auras/index.ts';
import { defineStats } from '../../src/modifiers/index.ts';
import { aura, type Game, makeGame, type TestAuras } from '../helpers/aura-game.ts';

describe('game fields and landing', () => {
  it('capture an application payload into the aura own fields on every landing, and clear them on release', () => {
    const { auras, id, unit } = makeGame({
      brand: aura({
        duration: 4,

        onLand: (ctx, application) => {
          ctx.aura.ext.snapshot = Math.max(ctx.aura.ext.snapshot, application.payload ?? 0);
        }
      })
    });

    const u = unit();

    auras.apply(u, { aura: id.brand, payload: 30 });
    auras.apply(u, { aura: id.brand, payload: 12 });
    assert.equal(auras.find(u, id.brand)?.ext.snapshot, 30);
    auras.remove(u, id.brand);
    auras.apply(u, id.brand);
    assert.equal(auras.find(u, id.brand)?.ext.snapshot, 0, 'the reused slot came back cleared');
  });

  it('raise nothing for an aura its own onLand swapped for another, and one applied for the other', () => {
    const seen: string[] = [];
    const late: { game?: Game<'charge' | 'surge'> } = {};

    const game = makeGame({
      charge: aura({
        duration: 4,

        onLand: (ctx) => {
          late.game?.auras.remove(ctx.bearer, late.game.id.charge);
          late.game?.auras.apply(ctx.bearer, late.game.id.surge);
        },

        onApplied: () => {
          seen.push('charge');

          return undefined;
        }
      }),
      surge: aura({
        duration: 4,

        onApplied: () => {
          seen.push('surge');

          return undefined;
        }
      })
    });

    late.game = game;

    const u = game.unit();

    game.auras.apply(u, game.id.charge);
    assert.deepEqual(seen, ['surge']);
    assert.deepEqual([game.auras.has(u, game.id.charge), game.auras.has(u, game.id.surge)], [false, true]);
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
          }
        })
      },
      { host: { statsOf: () => stats } }
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
        onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow) })
      }),

      plain: aura({ duration: 10 }),
      guard: aura({
        duration: 10,
        onIncomingDamage: () => ({ scale: 0.5 }),
        onIgnore: (_ctx, blow) => blow < 1
      }),
      escape: aura({ duration: 10, onLethal: () => ({ prevent: true, procs: ['heal'] }) })
    });

    const u = unit();
    const out: (ActiveAura<TestAuras> | undefined)[] = [];

    for (const name of ['escape', 'plain', 'guard', 'shield'] as const) {
      auras.apply(u, id[name]);
    }

    assert.equal(auras.collect(u, 'onIncomingDamage', out), 2);
    assert.deepEqual(
      out.map((a) => a?.id),
      [id.shield, id.guard]
    );
    assert.deepEqual(
      out.map((a) =>
        a === undefined ? undefined : auras.registry.get(a.id).onIncomingDamage?.(auras.context(u, a), 80)
      ),
      [{ absorb: 50 }, { scale: 0.5 }]
    );
    assert.equal(auras.collect(u, 'onLethal', out), 1);
    assert.deepEqual(
      out.map((a) => a?.id),
      [id.escape, undefined]
    );
    assert.equal(auras.registry.has.onIgnore.has(id.guard), true);
  });
});
