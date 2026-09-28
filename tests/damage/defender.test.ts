import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineMitigation, flat, percent } from '../../src/damage/index.ts';
import { hyperbolic, linear } from '../../src/modifiers/index.ts';
import { type DamageOverrides, makeDamageGame } from '../helpers/damage-game.ts';
import { invalid } from '../helpers/trigger-game.ts';

/** Armor with percentage then flat penetration (League of Legends' order), then damage taken. */
const PENETRATING = defineMitigation({
  armor: {
    kinds: ['physical'],
    rating: 'armor',
    penetration: [percent('armorPen'), flat('lethality')],
    curve: hyperbolic({ k: 100, negative: 'amplify' }),
  },

  taken: { kinds: 'all', multiplier: 'taken' },
});

describe('the block stage', () => {
  it('rolls once below the defender’s chance and ends a blocked blow, which leaves health alone', () => {
    const { damage, unit, set, rolls, log } = makeDamageGame({}, { block: { chance: 'blockChance' } });
    const target = unit(1);

    set(target, 'blockChance', 0.5);
    rolls.push(0.4, 0.6);

    const blocked = damage.hit({ target, amount: 10, knock: 2 });

    assert.deepEqual([blocked.status, blocked.amount, target.hp], ['blocked', 0, 100]);
    assert.equal(damage.hit({ target, amount: 10 }).status, 'landed');
    assert.deepEqual(log, ['roll block 0.4', 'roll block 0.6']);
  });

  it('is skipped by an unblockable blow and by a kind that bypasses it, with no draw', () => {
    const { damage, unit, set, log } = makeDamageGame({}, { block: { chance: 'blockChance' } });
    const target = unit(1);

    set(target, 'blockChance', 0.5);

    assert.equal(damage.hit({ target, amount: 10, isUnblockable: true }).status, 'landed');
    assert.equal(damage.hit({ target, amount: 10, kind: damage.kinds.id.pure }).status, 'landed');
    assert.deepEqual(log, []);
  });
});

describe('the crushing stage', () => {
  it('adds its share of the target’s maximum health before mitigation', () => {
    const { damage, unit, set } = makeDamageGame({});
    const target = unit(1);

    target.maxHp = 200;
    target.hp = 200;
    set(target, 'taken', 0.5);

    assert.equal(damage.hit({ target, amount: 10, crushing: 0.1, kind: damage.kinds.id.fire }).amount, 15);
  });
});

describe('the mitigation rows (§II.3.14)', () => {
  it('turn a rating into a reduction through its curve: 100 armor halves a blow', () => {
    const { damage, unit, set } = makeDamageGame({});
    const target = unit(1);

    set(target, 'armor', 100);

    const blow = damage.hit({ target, amount: 60 });

    assert.deepEqual([blow.amount, blow.mitigated], [30, 30]);
  });

  it('apply the attacker’s penetration in order, a percentage then a flat amount', () => {
    const { damage, unit, set } = makeDamageGame({}, { mitigation: PENETRATING });
    const [target, attacker] = [unit(1), unit(2)];

    set(target, 'armor', 100);
    set(attacker, 'armorPen', 0.3);
    set(attacker, 'lethality', 20);

    // 100 × (1 − 0.3) − 20 = 50 armor, a third off.
    assert.equal(damage.hit({ target, attacker, amount: 90 }).amount, 90 * (1 - 50 / (50 + 100)));
  });

  it('never take a positive rating below zero, and leave a negative one to the curve', () => {
    const { damage, unit, set } = makeDamageGame({}, { mitigation: PENETRATING });
    const [target, attacker] = [unit(1), unit(2)];

    set(target, 'armor', 10);
    set(attacker, 'lethality', 30);
    assert.equal(damage.hit({ target, attacker, amount: 40 }).amount, 40);

    set(target, 'armor', -50);
    // An amplifying curve reads −50 armor as the multiplier 2 − 100 / (100 + 50).
    assert.equal(damage.hit({ target, attacker, amount: 30 }).amount, 30 * (2 - 100 / (100 - -50)));
  });

  it('read a curve that gives nothing below zero as no reduction', () => {
    const zero = defineMitigation({
      armor: { kinds: 'all', rating: 'armor', curve: hyperbolic({ k: 120, negative: 'zero' }) },
    });

    const { damage, unit, set } = makeDamageGame({}, { mitigation: zero });
    const target = unit(1);

    set(target, 'armor', -40);
    assert.equal(damage.hit({ target, amount: 30 }).amount, 30);
    set(target, 'armor', 40);
    assert.equal(damage.hit({ target, amount: 30 }).amount, 30 * (1 - 40 / (40 + 120)));
  });

  it('apply only to their kinds, and never to a kind that bypasses mitigation', () => {
    const { damage, unit, set } = makeDamageGame({});
    const target = unit(1);

    set(target, 'armor', 100);
    set(target, 'taken', 1.5);

    assert.equal(damage.hit({ target, amount: 10, kind: damage.kinds.id.fire }).amount, 15);
    assert.equal(damage.hit({ target, amount: 10, kind: damage.kinds.id.pure }).amount, 10);
    assert.equal(damage.hit({ target, amount: 10 }).amount, 10 * 0.5 * 1.5);
  });

  it('are explained as data: each row’s rating before and after penetration, and its factor', () => {
    const { damage, unit, set } = makeDamageGame({}, { mitigation: PENETRATING });
    const [target, attacker] = [unit(1), unit(2)];

    set(target, 'armor', 120);
    set(target, 'taken', 1.1);
    set(attacker, 'lethality', 20);

    assert.deepEqual(damage.explainMitigation(target, { attacker }), {
      kind: damage.kinds.id.physical,
      rows: [
        { row: 'armor', kind: 'rating', value: 120, penetrated: 100, isAmplifying: false, factor: 0.5 },
        { row: 'taken', kind: 'multiplier', value: 1.1, penetrated: 1.1, isAmplifying: false, factor: 1.1 },
      ],
      factor: 0.5 * 1.1,
    });
    assert.deepEqual(damage.explainMitigation(target, { kind: damage.kinds.id.fire }).rows.length, 1);
  });

  it('are checked at load: every mitigated kind covered, stats of the right kind, a rating with its curve', () => {
    const only = (rows: Parameters<typeof defineMitigation>[0]): DamageOverrides =>
      invalid<DamageOverrides>({}, { mitigation: defineMitigation(rows) });

    assert.throws(
      () => makeDamageGame({}, only({ a: { kinds: ['physical'], multiplier: 'taken' } })),
      /fire is covered by no/,
    );
    assert.throws(() => makeDamageGame({}, only({ a: { kinds: 'all', rating: 'armor' } })), /not both/);
    assert.throws(
      () =>
        makeDamageGame(
          {},
          only({ a: { kinds: 'all', rating: 'armor', curve: linear(1), penetration: [percent('lethality')] } }),
        ),
      /lethality must be a multiplier stat/,
    );
    assert.throws(() => makeDamageGame({}, only({ a: { kinds: ['ice'], multiplier: 'taken' } })), /no damage kind ice/);
    assert.throws(
      () => makeDamageGame({}, only({ a: { kinds: 'all', multiplier: 'taken', penetration: [flat('armor')] } })),
      /needs a rating/,
    );
  });
});
