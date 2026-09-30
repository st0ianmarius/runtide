import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRIT, type DamageOverrides, makeDamageGame } from '../helpers/damage-game.ts';

/** The attacker side of the test game: `power` as the outgoing multiplier, and a crit. */
const ATTACKER: DamageOverrides = { outgoing: ['power'], rolls: CRIT };

describe('outgoing multipliers', () => {
  it('multiply every blow by the attacker’s stat, reading it unchanged at a share of 1', () => {
    const { damage, unit, set } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);

    set(attacker, 'power', 0.3);

    // 1 + 1 × (0.3 − 1) is 0.30000000000000004: the share-of-1 rule reads 0.3 as it is.
    assert.equal(damage.hit({ target: unit(1), amount: 100, attacker, kind: damage.kinds.id.fire }).amount, 30);
  });

  it('take the share the blow’s spell declares, through the host', () => {
    const { damage, unit, set, stat, shares } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);
    const fire = damage.kinds.id.fire;

    set(attacker, 'power', 1.4);
    shares.set(`5:${stat('power')}`, 0.5);
    shares.set(`6:${stat('power')}`, 0);

    assert.equal(
      damage.hit({ target: unit(1), amount: 10, attacker, spell: 5, kind: fire }).amount,
      10 * (1 + 0.5 * (1.4 - 1)),
    );
    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, spell: 6, kind: fire }).amount, 10);
    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, spell: 7, kind: fire }).amount, 14);
  });

  it('read a blow’s snapshot of its attacker’s stats in place of the live ones, even with no attacker', () => {
    const { damage, unit, set, stat } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);
    const fire = damage.kinds.id.fire;
    const snapshot = { total: (id: number): number => (id === stat('power') ? 2 : 0), base: (): number => 0 };

    set(attacker, 'power', 0.5);
    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, attackerStats: snapshot, kind: fire }).amount, 20);
    assert.equal(damage.hit({ target: unit(1), amount: 10, attackerStats: snapshot, kind: fire }).amount, 20);
  });

  it('do not apply to a blow nobody deals', () => {
    const { damage, unit, set, log } = makeDamageGame({}, ATTACKER);
    const target = unit(1);

    set(target, 'power', 3);
    set(target, 'critChance', 0.5);

    assert.equal(damage.hit({ target, amount: 10, kind: damage.kinds.id.fire }).amount, 10);
    assert.deepEqual(log, []);
  });
});

describe('the crit stage', () => {
  it('rolls once below the attacker’s chance, and multiplies a critical blow by its crit damage', () => {
    const { damage, unit, set, rolls, log } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);
    const fire = damage.kinds.id.fire;

    set(attacker, 'critChance', 0.25);
    rolls.push(0.2, 0.3);

    const first = damage.hit({ target: unit(1), amount: 10, attacker, kind: fire });

    assert.deepEqual([first.isCrit, first.amount], [true, 20]);

    const second = damage.hit({ target: unit(1), amount: 10, attacker, kind: fire });

    assert.deepEqual([second.isCrit, second.amount], [false, 10]);
    assert.deepEqual(log, ['roll crit 0.2', 'roll crit 0.3']);
  });

  it('draws nothing at a chance of 0 or of 1 and more', () => {
    const { damage, unit, set, log } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);

    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker }).isCrit, false);
    set(attacker, 'critChance', 1);
    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, kind: damage.kinds.id.fire }).amount, 20);
    assert.deepEqual(log, []);
  });

  it('takes the spell’s share of the chance and of the crit damage', () => {
    const { damage, unit, set, stat, shares, rolls } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);

    set(attacker, 'critChance', 0.5);
    shares.set(`3:${stat('critChance')}`, 0.5);
    shares.set(`3:${stat('critDamage')}`, 0.5);
    rolls.push(0.3, 0.2);

    const fire = damage.kinds.id.fire;

    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, spell: 3, kind: fire }).isCrit, false);
    assert.equal(damage.hit({ target: unit(1), amount: 10, attacker, spell: 3, kind: fire }).amount, 15);
  });

  it('takes a game’s own roll rule in place of the default (a draw even at a chance of 1)', () => {
    const draws: string[] = [];

    const { damage, unit, set } = makeDamageGame(
      {},
      {
        ...ATTACKER,

        rollChance: (chance, slot) => {
          draws.push(`${slot} ${chance}`);

          return true;
        },
      },
    );

    const attacker = unit(2);

    set(attacker, 'critChance', 1);
    damage.hit({ target: unit(1), amount: 10, attacker });
    assert.deepEqual(draws, ['crit 1']);
  });

  it('refuses outcome rows with neither a host roll nor a roll rule', () => {
    const { damage } = makeDamageGame({});
    const { roll: _roll, ...host } = damage.host;

    assert.throws(() => makeDamageGame({}, { ...ATTACKER, host }), /outcome rows need host.roll/);
  });
});

describe('the attacker-side float order', () => {
  it('is amount × outgoing × crit × each mitigation row, in that order', () => {
    const { damage, unit, set } = makeDamageGame({}, ATTACKER);
    const attacker = unit(2);
    const target = unit(1);

    set(attacker, 'power', 1.3);
    set(attacker, 'critChance', 1);
    set(attacker, 'critDamage', 1.75);
    set(target, 'armor', 30);
    set(target, 'taken', 1.1);
    target.maxHp = 1000;
    target.hp = 1000;

    assert.equal(damage.hit({ target, amount: 10, attacker }).amount, 10 * 1.3 * 1.75 * (1 - 30 / (30 + 100)) * 1.1);
  });
});
