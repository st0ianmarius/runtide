import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type AuraDecision, createAuraEvent } from '../../src/auras/index.ts';
import { createBus } from '../../src/core/index.ts';
import { aura, makeGame, type TestAuras } from '../helpers/aura-game.ts';

describe('a released bearer', () => {
  it('refuses every later application: no slot, policy, hook, tag edge, event or source binding', () => {
    const bus = createBus({ aura: createAuraEvent<TestAuras> });
    const heard: string[] = [];
    const calls: string[] = [];

    const { auras, id, unit } = makeGame(
      {
        stun: aura({ duration: 2, tags: ['stun'], boundToSource: true, onApplied: () => ['stunned'] }),
        ward: aura({ duration: 'infinite' })
      },
      {
        events: { bus, changed: bus.kind.aura },

        host: {
          run: (procs) => calls.push(...procs),
          onIncomingAura: () => {
            calls.push('policy');

            return undefined;
          },
          onTagsChanged: () => calls.push('tags')
        }
      }
    );

    const u = unit();

    auras.apply(u, id.ward);
    assert.equal(auras.release(u), 1);
    calls.length = 0;
    bus.on(bus.kind.aura, (event) => heard.push(event.change ?? '?'));

    const live = auras.pool.live;
    const changes = u.auras.changes;

    assert.deepEqual(auras.apply(u, { aura: id.stun, source: 7 }), { applied: false, fresh: false, changed: false });
    assert.deepEqual(auras.apply(u, { aura: id.ward, bypassPolicy: true }).applied, false);
    assert.deepEqual([auras.list(u).length, auras.pool.live, u.auras.changes], [0, live, changes]);
    assert.deepEqual([calls, heard], [[], []]);
    assert.equal(auras.sourceLeft(7), 0, 'no binding was kept for the source');
  });

  it('is marked even when it held nothing, and other bearers still take auras', () => {
    const { auras, id, unit } = makeGame({ ward: aura({ duration: 1 }) });
    const [gone, kept] = [unit(1), unit(2)];

    assert.equal(auras.release(gone), 0);
    assert.equal(auras.apply(gone, id.ward).applied, false);
    assert.equal(auras.apply(kept, id.ward).applied, true);
  });

  it('refuses an application a policy arms after one whose hook released its bearer', () => {
    const holder: { release?: () => void } = {};

    const { auras, id, unit } = makeGame(
      {
        doom: aura({ duration: 1, onApplied: () => ['release'] }),
        echo: aura({ duration: 1 })
      },
      {
        host: {
          run: (procs) => {
            if (procs.includes('release')) {
              holder.release?.();
            }
          },
          onIncomingAura: (_bearer, application): AuraDecision<TestAuras> | undefined =>
            application.aura === id.doom ? { after: [{ aura: id.echo }] } : undefined
        }
      }
    );

    const u = unit();

    holder.release = () => {
      auras.release(u);
    };

    assert.equal(auras.apply(u, id.doom).applied, true);
    assert.equal(auras.has(u, id.echo), false);
    assert.equal(auras.pool.live, 0);
  });
});
