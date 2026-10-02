import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import { aura, makeDamageGame } from '../helpers/damage-game.ts';

/** A cue table the throwing mappings fire into (they never do). */
const CUES = defineCues({ flash: defineCue({ anchor: 'entity' }) });

/** Auras whose hooks answer a broken number: an absorb-all, and NaN scales on every side of a blow and a heal. */
const AURAS = {
  sponge: aura({ duration: 10, onIncomingDamage: () => ({ absorb: Infinity }) }),
  brokenOut: aura({ duration: 10, onOutgoingDamage: () => ({ scale: Number.NaN }) }),
  brokenIn: aura({ duration: 10, onIncomingDamage: () => ({ scale: Number.NaN }) }),
  brokenHeal: aura({ duration: 10, onIncomingHeal: () => ({ scale: Number.NaN }) })
} as const;

describe('a blow of an infinite amount', () => {
  it('is skipped, running no stage, as an infinite heal is: no NaN amount, no health at -Infinity', () => {
    const calls: string[] = [];

    const { damage, auras, id, unit } = makeDamageGame(AURAS, {
      stages: {
        probe: {
          before: 'ignore',

          run: () => {
            calls.push('probe');

            return undefined;
          }
        }
      }
    });

    const [target, shielded] = [unit(1), unit(2)];

    auras.apply(shielded, id.sponge);

    for (const amount of [Infinity, -Infinity]) {
      const plain = damage.hit({ target, amount });
      const soaked = damage.hit({ target: shielded, amount });

      assert.deepEqual([plain.status, plain.amount, plain.overkill], ['skipped', 0, 0]);
      assert.deepEqual([soaked.status, soaked.amount, soaked.absorbed], ['skipped', 0, 0]);
    }

    assert.deepEqual([target.hp, shielded.hp, calls], [100, 100, []]);
    assert.equal(damage.heal({ target, amount: Infinity }).status, 'skipped');
  });
});

describe('a NaN scale or factor', () => {
  it('counts as 0 from an outgoing or incoming hook: the blow lands at nothing, never NaN', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker, other] = [unit(1), unit(2), unit(3)];

    auras.apply(attacker, id.brokenOut);
    auras.apply(other, id.brokenIn);

    const dealt = damage.hit({ target, attacker, amount: 30 });
    const taken = damage.hit({ target: other, amount: 30 });

    assert.deepEqual([dealt.status, dealt.amount, target.hp], ['landed', 0, 100]);
    assert.deepEqual([taken.status, taken.amount, other.hp], ['landed', 0, 100]);
  });

  it('counts as 0 from a mitigation multiplier stat, a heal hook or a healing stat', () => {
    const { damage, auras, id, unit, set } = makeDamageGame(AURAS, { heal: { received: 'healing' } });
    const [target, healed, mended] = [unit(1), unit(2), unit(3)];

    set(target, 'taken', Number.NaN);
    assert.deepEqual([damage.hit({ target, amount: 30 }).amount, target.hp], [0, 100]);

    healed.hp = 50;
    auras.apply(healed, id.brokenHeal);
    assert.deepEqual([damage.heal({ target: healed, amount: 20 }).amount, healed.hp], [0, 50]);

    mended.hp = 50;
    set(mended, 'healing', Number.NaN);
    assert.deepEqual([damage.heal({ target: mended, amount: 20 }).amount, mended.hp], [0, 50]);
  });
});

describe('the after-stages that throw', () => {
  it('surface the first error of a blow, the later ones suppressed into it, once every after-stage ran', () => {
    const deaths: number[] = [];

    const { damage, unit, bus } = makeDamageGame(
      {},
      {
        stages: {
          first: {
            after: 'health',

            run: () => {
              throw new Error('first');
            }
          },

          second: {
            after: 'first',

            run: () => {
              throw new Error('second');
            }
          }
        }
      }
    );

    const target = unit(1);

    bus.on(bus.kind.death, (event) => deaths.push(event.death?.unit.id ?? -1));
    bus.on(bus.kind.taken, () => {
      throw new Error('taken');
    });

    assert.throws(
      () => damage.hit({ target, amount: 500 }),
      (error: unknown) => {
        assert.ok(error instanceof SuppressedError);
        assert.equal((error.error instanceof Error && error.error.message) || '', 'first');
        assert.ok(error.suppressed instanceof SuppressedError);
        assert.deepEqual(
          [error.suppressed.error, error.suppressed.suppressed].map((each) =>
            each instanceof Error ? each.message : ''
          ),
          ['second', 'taken']
        );

        return true;
      }
    );

    assert.deepEqual([deaths, damage.depth], [[1], 0]);
  });

  it("raise a blow's events when its cue mapping throws, then throw it", () => {
    const seen: string[] = [];

    const { damage, unit, bus } = makeDamageGame(
      {},
      {
        cues: {
          out: createCueBuffer(CUES),

          blow: () => {
            throw new Error('cue');
          }
        }
      }
    );

    bus.on(bus.kind.taken, (event) => seen.push(`taken ${event.blow?.amount}`));
    assert.throws(() => damage.hit({ target: unit(1), amount: 30 }), /cue/);
    assert.deepEqual(seen, ['taken 30']);
  });

  it('raise the heal event when a heal cue or a game after-stage throws, then throw the first error', () => {
    const seen: string[] = [];

    const { damage, unit, bus } = makeDamageGame(
      {},
      {
        cues: {
          out: createCueBuffer(CUES),

          heal: () => {
            throw new Error('cue');
          }
        },

        healStages: {
          note: {
            after: 'health',

            run: () => {
              throw new Error('note');
            }
          }
        }
      }
    );

    const target = unit(1);

    target.hp = 50;
    bus.on(bus.kind.healed, (event) => seen.push(`healed ${event.heal?.amount}`));

    assert.throws(
      () => damage.heal({ target, amount: 20 }),
      (error: unknown) =>
        error instanceof SuppressedError &&
        error.error instanceof Error &&
        error.error.message === 'note' &&
        error.suppressed instanceof Error &&
        error.suppressed.message === 'cue'
    );

    assert.deepEqual([seen, target.hp, damage.depth], [['healed 20'], 70, 0]);
  });
});
