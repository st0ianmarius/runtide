import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type DamageOverrides, makeDamageGame } from '../helpers/damage-game.ts';

/**
 * A damage game whose host keeps the units it took out, as a unit system's lifecycle does, and logs each removal; its
 * death logs souls and loot, then runs the extra steps given, and a death rule may be given too.
 */
const makeLifecycleGame = (extra: NonNullable<DamageOverrides['death']> = {}, isDead?: DamageOverrides['isDead']) => {
  const gone = new Set<number>();
  const log: string[] = [];

  const game = makeDamageGame(
    {},
    {
      ...(isDead === undefined ? {} : { isDead }),

      death: {
        before: [(death) => log.push(`souls ${death.unit.id}`), ...(extra.before ?? [])],
        after: [(death) => log.push(`loot ${death.unit.id}`), ...(extra.after ?? [])]
      }
    },
    {
      isGone: (unit) => gone.has(unit.id),

      setHealth: (unit, hp) => {
        unit.hp = Math.max(0, hp);
        log.push(`health ${unit.id} ${hp}`);
      },

      remove: (unit) => {
        gone.add(unit.id);
        log.push(`remove@${unit.id}`);
      }
    }
  );

  game.bus.on(game.bus.kind.death, ({ death }) => log.push(`death ${death?.unit.id}`));
  game.bus.on(game.bus.kind.kill, ({ death }) => log.push(`kill ${death?.unit.id} by ${death?.killer?.id}`));

  return { ...game, log, gone };
};

describe('kill', () => {
  it('takes out a unit the death rule already counts dead, which setHealth cannot', () => {
    const { damage, unit, log } = makeLifecycleGame();
    const [downed, killer] = [unit(1), unit(2)];

    downed.hp = 0;

    assert.equal(damage.setHealth(downed, 0, { attacker: killer }).status, 'skipped');
    assert.deepEqual(log, []);
    assert.equal(damage.kill(downed, { attacker: killer }), true);
    assert.deepEqual(log, ['health 1 0', 'souls 1', 'death 1', 'kill 1 by 2', 'loot 1', 'remove@1']);
    assert.equal(damage.depth, 0);
  });

  it('sets a living unit’s health to 0 through the host first, and runs the whole death', () => {
    const { damage, unit, log } = makeLifecycleGame();
    const target = unit(1);

    assert.deepEqual([damage.kill(target, { source: 7 }), target.hp], [true, 0]);
    assert.deepEqual(log, ['health 1 0', 'souls 1', 'death 1', 'kill 1 by undefined', 'loot 1', 'remove@1']);
  });

  it('returns false for a unit already gone, and runs nothing', () => {
    const { damage, unit, log } = makeLifecycleGame();
    const target = unit(1);

    assert.equal(damage.kill(target), true);
    log.length = 0;
    assert.equal(damage.kill(target), false);
    assert.deepEqual(log, []);
  });

  it('counts a unit dead by health alone for a host with no isGone', () => {
    const { damage, unit, log } = makeDamageGame({});
    const target = unit(1);

    target.hp = 0;

    assert.equal(damage.kill(target), false);
    assert.equal(damage.kill(unit(2)), true);
    assert.deepEqual(log, ['remove@2']);
  });
});

describe('a unit whose death is running', () => {
  it('dies once in a mutual soul link: each death kills the other, and the second kill of the first is refused', () => {
    const links = new Map<number, number>([
      [1, 2],
      [2, 1]
    ]);

    const kills: boolean[] = [];

    const { damage, unit, log, gone } = makeLifecycleGame({
      after: [
        (death, system) => {
          const other = units.get(links.get(death.unit.id) ?? 0);

          if (other !== undefined) {
            kills.push(system.kill(other, { attacker: death.unit }));
          }
        }
      ]
    });

    const units = new Map([1, 2].map((id) => [id, unit(id)]));

    assert.equal(damage.kill(units.get(1) ?? unit(1)), true);
    assert.deepEqual(log, [
      'health 1 0',
      'souls 1',
      'death 1',
      'loot 1',
      'health 2 0',
      'souls 2',
      'death 2',
      'kill 2 by 1',
      'loot 2',
      'remove@2',
      'remove@1'
    ]);
    assert.deepEqual(kills, [false, true]);
    assert.deepEqual([gone.has(1), gone.has(2), damage.dropped, damage.depth], [true, true, 0, 0]);
  });

  it('skips a blow and a heal on it from its own death, though its health is not dead by the rule', () => {
    const outcomes: string[] = [];

    const { damage, unit, log } = makeLifecycleGame(
      {
        before: [
          (death, system) => {
            outcomes.push(system.hit({ target: death.unit, amount: 50 }).status);
            outcomes.push(system.heal({ target: death.unit, amount: 50 }).status);
          }
        ]
      },
      (health) => health < 0
    );

    const target = unit(1);

    assert.equal(damage.kill(target), true);
    assert.deepEqual([outcomes, target.hp], [['skipped', 'skipped'], 0]);
    assert.deepEqual(log, ['health 1 0', 'souls 1', 'death 1', 'loot 1', 'remove@1']);
  });

  it('refuses a kill of it from inside its own death, and counts it dead there', () => {
    const seen: boolean[] = [];

    const { damage, unit, log } = makeLifecycleGame(
      {
        before: [(death, system) => seen.push(system.kill(death.unit), system.isDead(death.unit))]
      },
      (health) => health < 0
    );

    const target = unit(1);

    target.hp = 0;
    assert.equal(damage.isDead(target), false);
    assert.equal(damage.kill(target), true);
    assert.deepEqual(seen, [false, true]);
    assert.deepEqual([log, damage.dropped], [['health 1 0', 'souls 1', 'death 1', 'loot 1', 'remove@1'], 0]);
  });
});

describe('the kill event', () => {
  it('is raised for a death credited to a source with no attacker, its killer undefined', () => {
    const { damage, unit, log } = makeLifecycleGame();

    damage.hit({ target: unit(1), amount: 500, source: 42 });

    assert.deepEqual(log, ['health 1 -400', 'souls 1', 'death 1', 'kill 1 by undefined', 'loot 1', 'remove@1']);
  });

  it('is not raised for a death credited to no one', () => {
    const { damage, unit, log } = makeLifecycleGame();

    damage.hit({ target: unit(1), amount: 500 });

    assert.deepEqual(log, ['health 1 -400', 'souls 1', 'death 1', 'loot 1', 'remove@1']);
  });
});

describe('a death whose parts throw', () => {
  it('throws the first error, the later ones (a listener’s) attached, never masking it', () => {
    const { damage, unit, bus, log } = makeDamageGame(
      {},
      {
        death: {
          before: [
            () => {
              throw new Error('souls');
            }
          ]
        }
      }
    );

    bus.on(bus.kind.death, () => {
      throw new Error('listener');
    });

    const thrown = (() => {
      try {
        damage.hit({ target: unit(1), attacker: unit(2), amount: 150 });
      } catch (error) {
        return error;
      }

      return undefined;
    })();

    assert.ok(thrown instanceof SuppressedError);
    assert.deepEqual(
      [thrown.error, thrown.suppressed].map((error: unknown) => (error instanceof Error ? error.message : error)),
      ['souls', 'listener']
    );
    assert.deepEqual([log, damage.depth], [['remove@1'], 0]);
  });

  it('throws a lone error as it is', () => {
    const souls = new Error('souls');

    const { damage, unit } = makeDamageGame(
      {},
      {
        death: {
          before: [
            () => {
              throw souls;
            }
          ]
        }
      }
    );

    assert.throws(
      () => damage.hit({ target: unit(1), amount: 150 }),
      (error) => error === souls
    );
  });
});
