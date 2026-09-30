import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aura, makeDamageGame } from '../helpers/damage-game.ts';

/** Heal stats: healing received and done. */
const HEALING = { heal: { received: 'healing', done: 'healingDone' } } as const;

describe('the heal pipeline', () => {
  it('multiplies by the healer’s healing done and the target’s healing received, up to maximum health', () => {
    const { damage, unit, set } = makeDamageGame({}, HEALING);
    const [target, healer] = [unit(1), unit(2)];

    target.hp = 50;
    set(healer, 'healingDone', 1.5);
    set(target, 'healing', 2);

    const healed = damage.heal({ target, healer, amount: 10 });

    assert.deepEqual([healed.status, healed.amount, healed.overheal, target.hp], ['landed', 30, 0, 80]);

    const capped = damage.heal({ target, amount: 30 });

    assert.deepEqual([capped.amount, capped.overheal, capped.healthAfter, target.hp], [20, 40, 100, 100]);
  });

  it('is skipped on a dead unit or with no or an infinite amount', () => {
    const { damage, unit } = makeDamageGame({}, HEALING);
    const target = unit(1);
    const dead = unit(2);

    target.hp = 50;
    dead.hp = 0;

    assert.equal(damage.heal({ target: dead, amount: 10 }).status, 'skipped');
    assert.equal(damage.heal({ target, amount: Infinity }).status, 'skipped');
    assert.equal(damage.heal({ target, amount: 0 }).status, 'skipped');
  });

  it('takes game stages at their positions, one blocking a wounded target’s heals', () => {
    const { damage, auras, id, unit } = makeDamageGame(
      { wounded: aura({ duration: 5, tags: ['wound'] }) },
      {
        healStages: {
          wound: {
            before: 'done',

            run: (heal, damage) =>
              damage.auras.hasTag(heal.target, damage.auras.tags.id.wound) ? 'blocked' : undefined,
          },

          halve: {
            before: 'health',

            run: (heal) => {
              heal.amount /= 2;

              return undefined;
            },
          },
        },
      },
    );

    const [target, wounded] = [unit(1), unit(9)];

    target.hp = 50;
    wounded.hp = 50;
    auras.apply(wounded, id.wounded);

    assert.deepEqual(damage.healStages, ['wound', 'done', 'received', 'halve', 'health', 'outcome']);
    assert.equal(damage.heal({ target, amount: 10 }).amount, 5);
    assert.deepEqual([damage.heal({ target: wounded, amount: 10 }).status, wounded.hp], ['blocked', 50]);
  });

  it('raises the heal event for a landed heal', () => {
    const { damage, unit, bus, log } = makeDamageGame({});
    const target = unit(1);

    bus.on(bus.kind.healed, (event) => log.push(`healed ${event.heal?.amount}@${event.heal?.target.id}`));
    target.hp = 90;
    damage.heal({ target, amount: 20 });
    assert.deepEqual(log, ['healed 10@1']);
  });
});

describe('setHealth', () => {
  it('bypasses the heal stages', () => {
    const { damage, auras, id, unit, set } = makeDamageGame(
      { wounded: aura({ duration: 5, tags: ['wound'] }) },
      HEALING,
    );

    const target = unit(1);

    set(target, 'healing', 0.5);
    auras.apply(target, id.wounded);

    assert.equal(damage.setHealth(target, 40).status, 'landed');
    assert.equal(target.hp, 40);
  });

  it('runs the death pipeline when it kills, credited as given, and skips a dead unit', () => {
    const { damage, unit, bus, log } = makeDamageGame({});
    const [target, killer] = [unit(1), unit(2)];

    bus.on(bus.kind.kill, (event) => log.push(`kill ${event.death?.unit.id} by ${event.death?.killer?.id}`));

    assert.equal(damage.setHealth(target, 0, { attacker: killer }).hasKilled, true);
    assert.equal(damage.setHealth(target, 50).status, 'skipped');
    assert.deepEqual(log, ['kill 1 by 2', 'remove@1']);
  });
});

describe('the force pipeline', () => {
  it('goes through the target’s onIncomingForce hooks, then the host moves the unit', () => {
    const { damage, auras, id, unit, log } = makeDamageGame({
      heavy: aura({ duration: 5, onIncomingForce: () => ({ scale: 0.5 }) }),
      rooted: aura({ duration: 5, onIncomingForce: (_ctx, force) => ({ isCancelled: force.kind === 'pull' }) }),
    });

    const target = unit(1);

    auras.apply(target, id.heavy);
    auras.apply(target, id.rooted);

    assert.deepEqual(
      [damage.force({ target, strength: 4 }).amount, damage.force({ target, strength: 4, kind: 'pull' }).status],
      [2, 'ignored'],
    );
    assert.equal(damage.force({ target, strength: 0 }).status, 'skipped');
    assert.deepEqual(log, ['force knock 2@1']);
  });

  it('takes game stages (an immunity trait, a resist cap)', () => {
    const { damage, unit, log } = makeDamageGame(
      {},
      {
        forceStages: {
          immovable: { before: 'resist', run: (force) => (force.target.id === 7 ? 'ignored' : undefined) },

          cap: {
            before: 'apply',

            run: (force) => {
              force.amount = Math.min(force.amount, 1.5);

              return undefined;
            },
          },
        },
      },
    );

    damage.force({ target: unit(7), strength: 3 });
    damage.force({ target: unit(1), strength: 3 });
    assert.deepEqual(log, ['force knock 1.5@1']);
  });

  it('knocks from a game after-stage along the blow’s direction, the force carrying its blow', () => {
    const seen: string[] = [];

    const { damage, unit } = makeDamageGame(
      {},
      {
        stages: {
          shove: {
            after: 'outcome',

            run: (blow, system) => {
              if (blow.status === 'landed') {
                system.force({ target: blow.target, strength: 0.5, direction: blow.direction, blow });
              }

              return undefined;
            },
          },
        },

        forceStages: {
          probe: {
            before: 'apply',

            run: (force) => {
              seen.push(`${force.amount} ${force.direction?.x},${force.direction?.z} ${force.blow?.amount}`);

              return undefined;
            },
          },
        },
      },
    );

    damage.hit({ target: unit(1), amount: 5, direction: { x: 1, z: 0 } });
    assert.deepEqual(seen, ['0.5 1,0 5']);
  });
});

describe('the death pipeline', () => {
  it('runs the rewards before, the death and kill events, the rewards after, then removal', () => {
    const order: string[] = [];

    const { damage, unit, bus, log } = makeDamageGame(
      {},
      {
        death: {
          before: [(death) => order.push(`souls ${death.unit.id}`)],
          after: [(death) => order.push(`loot ${death.blow?.dealt}`)],
        },
      },
    );

    const [target, killer] = [unit(1), unit(2)];

    bus.on(bus.kind.death, (event) => order.push(`death ${event.death?.unit.id}`));
    bus.on(bus.kind.kill, (event) => order.push(`kill ${event.death?.killer?.id}`));
    damage.hit({ target, attacker: killer, amount: 150 });

    assert.deepEqual(order, ['souls 1', 'death 1', 'kill 2', 'loot 100']);
    assert.deepEqual(log, ['remove@1']);
  });

  it('gives an inert unit no rewards and no events, and still removes it', () => {
    const order: string[] = [];

    const { damage, unit, bus, log } = makeDamageGame(
      {},
      { death: { before: [() => order.push('souls')] } },
      { isInert: (target) => target.id === 1 },
    );

    const wall = unit(1);

    bus.on(bus.kind.death, () => order.push('death'));
    damage.hit({ target: wall, amount: 150, attacker: unit(2) });

    assert.deepEqual(order, []);
    assert.deepEqual(log, ['remove@1']);
  });

  it('never runs for a blow that did not kill, nor twice for one target', () => {
    const deaths: number[] = [];
    const { damage, unit, bus } = makeDamageGame({});
    const target = unit(1);

    bus.on(bus.kind.death, (event) => deaths.push(event.death?.unit.id ?? -1));
    bus.on(bus.kind.taken, (event) => {
      if (event.blow?.hasKilled === false) {
        damage.hit({ target, amount: 100 });
      }
    });

    damage.hit({ target, amount: 10 });
    damage.hit({ target, amount: 10 });
    assert.deepEqual(deaths, [1]);
  });
});
