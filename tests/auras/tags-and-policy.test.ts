import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuraDecision } from '../../src/auras/index.ts';
import { aura, makeGame, TAGS, type TestAuras } from '../helpers/aura-game.ts';

const defs = {
  ward: aura({ duration: 6, tags: ['immune'] }),
  scald: aura({ duration: 3, tags: ['poison'], blockedBy: ['immune'] }),
  hex: aura({ duration: 3, tags: ['magic', 'poison'] }),
  purge: aura({ duration: 1, removes: ['poison', 'magic'], blockedBy: ['immune'] }),
  sweep: aura({ duration: 1, removes: ['magic', 'poison'] }),
  stun: aura({ duration: 1, tags: ['stun'], removedOn: ['down', 'dead'] }),
  brand: aura({ duration: 8, boundToSource: true }),
  mark: aura({ duration: 8 }),
  rend: aura({ duration: 5, stacking: 'stack', maxStacks: 5 }),
  shell: aura({
    duration: 10,
    value: 30,
    stacking: 'highest',
    merge: 'max',
    keepWhenDepleted: true
  }),
  barrier: aura({ duration: 10, value: 30 }),
  slow: aura({ duration: 4, tags: ['stun'] })
};

describe('tags, immunities and cleanses', () => {
  it('grant tags while active, as a bitset over tag ids', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.hex);
    assert.deepEqual(u.auras.tags.toArray(), [TAGS.id.magic, TAGS.id.poison]);
    assert.equal(auras.hasTag(u, TAGS.id.magic), true);
    auras.remove(u, id.hex);
    assert.equal(auras.hasTag(u, TAGS.id.magic), false);
  });

  it('turn an application away on a blockedBy tag, and cleanse with removes first', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.scald);
    auras.apply(u, id.sweep);
    assert.equal(auras.has(u, id.scald), false, 'cleansed');
    auras.apply(u, id.ward);
    assert.deepEqual(auras.apply(u, id.scald), { applied: false, fresh: false, changed: false });
    assert.equal(auras.removeByTag(u, TAGS.id.immune), 1);
    assert.equal(auras.apply(u, id.scald).applied, true);
  });

  it('test blockedBy before removes: an immunity beats a cleanse, which then removes nothing', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.ward);
    auras.apply(u, id.hex);
    assert.equal(auras.apply(u, id.purge).applied, false);
    assert.equal(auras.has(u, id.hex), true);
  });

  it('cleanse tag by tag, each in list order', () => {
    const removed: string[] = [];

    const onRemoved = (name: string) => () => {
      removed.push(name);

      return undefined;
    };

    const { auras, registry, unit } = makeGame({
      venom: aura({ duration: 5, tags: ['poison'], onRemoved: onRemoved('venom') }),
      curse: aura({ duration: 5, tags: ['magic'], onRemoved: onRemoved('curse') }),
      sweep: aura({ duration: 1, removes: ['magic', 'poison'] })
    });

    const u = unit();

    auras.apply(u, registry.id.venom);
    auras.apply(u, registry.id.curse);
    auras.apply(u, registry.id.sweep);
    assert.deepEqual(removed, ['curse', 'venom']);
  });
});

describe('removal and suppression', () => {
  it('removes the auras a bearer state names as it enters it', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.stun);
    auras.apply(u, id.mark);
    assert.equal(auras.enterState(u, 'down'), 1);
    assert.equal(auras.has(u, id.mark), true);
  });

  it('removes the auras bound to a source that is gone, and only those', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.brand, source: 3 });
    auras.apply(u, { aura: id.mark, source: 3 });
    assert.equal(auras.sourceGone(u, 4), 0);
    assert.equal(auras.sourceGone(u, 3), 1);
    assert.equal(auras.has(u, id.mark), true);
  });

  it('takes a source’s bound auras off every bearer as it leaves, following a bound aura to its new source', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const [a, b, c] = [unit(1), unit(2), unit(3)];

    auras.apply(a, { aura: id.brand, source: 3 });
    auras.apply(a, { aura: id.mark, source: 3 });
    auras.apply(b, { aura: id.brand, source: 3 });
    auras.apply(c, { aura: id.brand, source: 4 });
    auras.apply(c, { aura: id.brand, source: 5 });
    assert.equal(auras.sourceLeft(4), 0, 'c’s brand now credits 5');
    assert.equal(auras.sourceLeft(3), 2);
    assert.deepEqual(
      [a, b].map((bearer) => auras.has(bearer, id.brand)),
      [false, false]
    );
    assert.equal(auras.has(a, id.mark), true, 'an aura not bound stays');
    assert.equal(auras.sourceLeft(3), 0, 'nothing left to sweep');
    run(c, 65);
    assert.equal(auras.has(c, id.brand), false);
    assert.equal(auras.sourceLeft(5), 0, 'an expired aura leaves the index');
  });

  it('spends stacks in order and refuses, spending nothing, when too few are held', () => {
    const { auras, id, unit } = makeGame(defs);
    const u = unit();

    auras.apply(u, { aura: id.rend, stacks: 3 });
    assert.equal(auras.spendStacks(u, id.rend, 4), false);
    assert.equal(auras.stacks(u, id.rend), 3);
    assert.equal(auras.spendStacks(u, id.rend, 0), true);
    assert.equal(auras.spendStacks(u, id.rend, 2), true);
    assert.equal(auras.stacks(u, id.rend), 1);
    assert.equal(auras.spendStacks(u, id.rend, 1), true);
    assert.equal(auras.has(u, id.rend), false);
  });

  it('spends value like an absorb: kept at 0 when it keeps its clock, else removed', () => {
    const { auras, id, unit, run } = makeGame(defs);
    const u = unit();

    auras.apply(u, id.shell);
    auras.apply(u, id.barrier);
    assert.equal(auras.spendValue(u, id.shell, 12), 12);
    assert.equal(auras.spendValue(u, id.shell, 50), 18);
    assert.equal(auras.find(u, id.shell)?.value, 0);
    assert.equal(auras.spendValue(u, id.shell, 5), 0, 'nothing left to spend');
    run(u, 8);
    assert.equal(auras.apply(u, { aura: id.shell, value: 20, duration: 1 }).changed, true, 'a larger value merges');
    assert.equal(auras.find(u, id.shell)?.value, 20);
    assert.equal(auras.remaining(u, id.shell), 9, 'while the longer clock stays');
    assert.equal(auras.spendValue(u, id.barrier, 30), 30);
    assert.equal(auras.has(u, id.barrier), false);
  });
});

describe("the host's application policy", () => {
  it('bypasses only the incoming policy for bookkeeping applications, preserving aura rules and tag edges', () => {
    let incoming = 0;
    let edges = 0;

    const { auras, id, unit } = makeGame(defs, {
      host: {
        onIncomingAura: () => {
          incoming += 1;

          return { refuse: true };
        },

        onTagsChanged: () => {
          edges += 1;
        }
      }
    });

    const u = unit(1);

    assert.equal(auras.apply(u, { aura: id.ward, bypassPolicy: true }).applied, true);
    assert.equal(auras.has(u, id.ward), true);
    assert.equal(edges, 1);
    assert.equal(auras.apply(u, { aura: id.scald, bypassPolicy: true }).applied, false, 'blockedBy still applies');
    assert.equal(incoming, 0);
    assert.equal(auras.apply(u, { aura: id.mark, bypassPolicy: false }).applied, false);
    assert.equal(incoming, 1);
  });

  it('refuses, substitutes, scales and arms more after, and a refusal raises nothing', () => {
    const { auras, id, unit, log } = makeGame(
      { ...defs, slow: aura({ duration: 4, onApplied: () => ['slowed'] }) },
      {
        host: {
          run: (procs) => {
            log.push(...procs);
          },

          onIncomingAura: (bearer, application): AuraDecision<TestAuras> | undefined => {
            if (bearer.id === 9) {
              return { refuse: true };
            }

            if (application.aura === id.stun && bearer.id === 2) {
              return { apply: { aura: id.slow } };
            }

            if (application.aura === id.stun) {
              const duration = 0.75 * auras.lengthOf(application.aura, bearer);

              return {
                apply: { ...application, duration },
                after: [{ aura: id.ward, duration: 2 * duration }]
              };
            }

            return undefined;
          }
        }
      }
    );

    const [boss, elite, immune] = [unit(2), unit(3), unit(9)];

    assert.deepEqual(auras.apply(immune, id.stun), {
      applied: false,
      fresh: false,
      changed: false
    });
    auras.apply(boss, id.stun);
    auras.apply(elite, id.stun);
    assert.deepEqual([auras.has(boss, id.stun), auras.has(boss, id.slow)], [false, true]);
    assert.deepEqual([auras.remaining(elite, id.stun), auras.remaining(elite, id.ward)], [0.75, 1.5]);
    assert.deepEqual(log, ['slowed']);
  });
});
