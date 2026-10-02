import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBus } from '../../src/core/index.ts';
import { createForceEvent, type ForceEvent } from '../../src/damage/index.ts';
import { aura, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** A bus with the force event alone. */
const makeForceBus = () => createBus({ forced: (): ForceEvent<Game> => createForceEvent<Game>() });

describe('the forced event', () => {
  it('is raised once per force that was not skipped, after the host applied it, and lets go of it', () => {
    const bus = makeForceBus();
    const payloads: ForceEvent<Game>[] = [];

    const { damage, auras, id, unit, log } = makeDamageGame(
      { rooted: aura({ duration: 5, onIncomingForce: (_ctx, force) => ({ isCancelled: force.kind === 'pull' }) }) },
      { events: { bus, forced: bus.kind.forced } }
    );

    const [target, attacker] = [unit(1), unit(2)];

    bus.on(bus.kind.forced, (event) => {
      payloads.push(event);
      log.push(`forced ${event.force?.status} ${event.force?.amount} by ${event.force?.attacker?.id}`);
    });
    auras.apply(target, id.rooted);
    damage.force({ target, attacker, strength: 2 });
    damage.force({ target, strength: 2, kind: 'pull' });
    damage.force({ target, strength: 0 });

    assert.deepEqual(log, ['force knock 2@1', 'forced landed 2 by 2', 'forced ignored 0 by undefined']);
    assert.equal(payloads[0]?.force, undefined);
  });
});

describe('a force’s strength', () => {
  it('is skipped when not finite, the host never handed it', () => {
    const { damage, unit, log } = makeDamageGame({});
    const target = unit(1);

    assert.equal(damage.force({ target, strength: Infinity }).status, 'skipped');
    assert.equal(damage.force({ target, strength: Number.NaN }).status, 'skipped');
    assert.deepEqual(log, []);
  });

  it('is 0 under a NaN scale, never NaN at the host', () => {
    const { damage, auras, id, unit, log } = makeDamageGame({
      broken: aura({ duration: 5, onIncomingForce: () => ({ scale: Number.NaN }) })
    });

    const target = unit(1);

    auras.apply(target, id.broken);

    assert.equal(damage.force({ target, strength: 3 }).amount, 0);
    assert.deepEqual(log, ['force knock 0@1']);
  });
});

describe('the onIncomingForce hooks', () => {
  it('see the force’s attacker as their other unit', () => {
    const others: (number | undefined)[] = [];

    const { damage, auras, id, unit } = makeDamageGame({
      watch: aura({
        duration: 5,

        onIncomingForce: (ctx) => {
          others.push(ctx.other?.id);

          return undefined;
        }
      })
    });

    const target = unit(1);

    auras.apply(target, id.watch);
    damage.force({ target, attacker: unit(2), strength: 1 });
    damage.force({ target, strength: 1 });

    assert.deepEqual(others, [2, undefined]);
  });
});
