import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { copyBlow, damage } from '../../src/damage/index.ts';
import { aura, type Game, makeDamageGame } from '../helpers/damage-game.ts';

/** An ally's `onDealt` aura dealing an extra blow of 10 for each blow its bearer deals, with one attacker option. */
const extraBlow = (attacker: 'self' | 'credited') =>
  aura({
    duration: 5,
    onDealt: (_ctx, blow) => (blow.aura === undefined ? [damage<Game>(10, { attacker })] : undefined)
  });

describe('a damage proc’s attacker', () => {
  it('is the list’s self with self, dealing with the bearer’s stats, still credited to the aura’s source', () => {
    const {
      damage: system,
      auras,
      id,
      unit,
      set,
      bus
    } = makeDamageGame({ self: extraBlow('self'), credited: extraBlow('credited') }, { outgoing: ['power'] });

    const [bearer, ally, target] = [unit(1), unit(2), unit(3)];
    const seen: string[] = [];

    bus.on(bus.kind.taken, ({ blow }) => {
      if (blow?.aura !== undefined) {
        seen.push(`${blow.attacker?.id} ${blow.source} ${blow.amount}`);
      }
    });
    set(bearer, 'power', 2);
    set(ally, 'power', 3);
    auras.apply(bearer, { aura: id.self, source: ally.id });
    system.hit({ target, attacker: bearer, amount: 1 });
    auras.remove(bearer, id.self);
    auras.apply(bearer, { aura: id.credited, source: ally.id });
    system.hit({ target, attacker: bearer, amount: 1 });

    assert.deepEqual(seen, ['1 2 20', '2 2 30']);
  });
});

describe('the host’s creditOf', () => {
  it('credits a blow, heal and kill with an attacker but no source to the unit it names', () => {
    const { damage: system, unit } = makeDamageGame({}, {}, { creditOf: (pet) => (pet.id === 5 ? 1 : pet.id) });
    const [target, pet] = [unit(3), unit(5)];

    assert.equal(system.hit({ target, attacker: pet, amount: 1 }).source, 1);
    assert.equal(system.hit({ target, attacker: pet, amount: 1, source: 9 }).source, 9);
    assert.equal(system.heal({ target, healer: pet, amount: 1 }).source, 1);
  });

  it('leaves the credit to idOf when absent', () => {
    const { damage: system, unit } = makeDamageGame({});

    assert.equal(system.hit({ target: unit(3), attacker: unit(5), amount: 1 }).source, 5);
  });
});

describe('copyBlow', () => {
  it('keeps a blow’s outcome past the next hit, which reuses the pooled record', () => {
    const { damage: system, unit } = makeDamageGame({});
    const [target, attacker] = [unit(1), unit(2)];
    const first = system.hit({ target, attacker, amount: 30 });
    const kept = copyBlow(first);
    const second = system.hit({ target, amount: 80 });

    assert.equal(first, second);
    assert.ok(Object.isFrozen(kept));
    assert.deepEqual(
      [kept.amount, kept.dealt, kept.overkill, kept.hasKilled, kept.attacker?.id, kept.source, kept.status],
      [30, 30, 0, false, 2, 2, 'landed']
    );
    assert.deepEqual([second.dealt, second.overkill, second.hasKilled], [70, 10, true]);
  });
});
