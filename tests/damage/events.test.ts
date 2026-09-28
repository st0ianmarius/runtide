import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BLOW_STATUSES, damageTriggerEvent, deathTriggerEvent, healTriggerEvent } from '../../src/damage/index.ts';
import { applyAura } from '../../src/procs/index.ts';
import { createTriggerSystem } from '../../src/triggers/index.ts';
import { aura, type DamageOverrides, type Game, KINDS, makeDamageGame } from '../helpers/damage-game.ts';

/** Auras whose triggers answer the damage events, each marking its owner with a flag aura. */
const AURAS = {
  frenzied: aura({ duration: 3 }),
  bruised: aura({ duration: 3 }),
  scorched: aura({ duration: 3 }),
  gorged: aura({ duration: 3 }),
  soothed: aura({ duration: 3 }),

  listener: aura({
    duration: 'infinite',
    triggers: [
      { on: 'dealt', when: [{ filter: 'crit' }], do: [applyAura<Game>('frenzied')] },
      {
        on: 'taken',
        when: [
          { filter: 'minAmount', arg: 20 },
          { filter: 'status', arg: 'landed' },
        ],
        do: [applyAura<Game>('bruised')],
      },
      { on: 'taken', when: [{ filter: 'damageKind', arg: 'fire' }], do: [applyAura<Game>('scorched')] },
      { on: 'kill', do: [applyAura<Game>('gorged')] },
      { on: 'healed', when: [{ filter: 'minAmount', arg: 5 }], do: [applyAura<Game>('soothed')] },
    ],
  }),
} as const;

/** A game whose units answer the damage events with their `listener` aura's triggers. */
const makeTriggerGame = (overrides: DamageOverrides = {}) => {
  const game = makeDamageGame(AURAS, overrides);
  const { bus } = game;

  createTriggerSystem<Game>({
    auras: game.auras,
    procs: game.procs,
    bus,
    events: {
      dealt: damageTriggerEvent(bus.kind.dealt, { about: 'attacker', kinds: KINDS }),
      taken: damageTriggerEvent(bus.kind.taken, { about: 'target', kinds: KINDS }),
      healed: healTriggerEvent(bus.kind.healed, 'target'),
      death: deathTriggerEvent(bus.kind.death, 'unit'),
      kill: deathTriggerEvent(bus.kind.kill, 'killer'),
    },
  });

  const listening = (id: number) => {
    const made = game.unit(id);

    game.auras.apply(made, game.id.listener);

    return made;
  };

  return { ...game, listening };
};

describe('the damage events', () => {
  it('raise dealt about the attacker, then taken about the target, for every blow not skipped or ignored', () => {
    const { damage, unit, bus, log, auras, id } = makeDamageGame({
      shield: aura({ duration: 'infinite', onIgnore: () => true }),
    });

    const [target, attacker, immune] = [unit(1), unit(2), unit(3)];

    bus.on(bus.kind.dealt, (event) => log.push(`dealt ${event.blow?.attacker?.id} ${event.blow?.status}`));
    bus.on(bus.kind.taken, (event) => log.push(`taken ${event.blow?.target.id} ${event.blow?.status}`));
    auras.apply(immune, id.shield);
    damage.hit({ target, attacker, amount: 10 });
    damage.hit({ target, amount: 10 });
    damage.hit({ target: immune, attacker, amount: 10 });
    damage.hit({ target, attacker, amount: 0 });

    assert.deepEqual(log, ['dealt 2 landed', 'taken 1 landed', 'taken 1 landed']);
  });

  it('name the blow statuses in code order', () => {
    assert.deepEqual(BLOW_STATUSES, ['skipped', 'ignored', 'blocked', 'absorbed', 'landed']);
  });
});

describe('the damage trigger events', () => {
  it('carry the crit, status, amount and kind filters to the attacker’s and the target’s triggers', () => {
    const game = makeTriggerGame({ crit: { chance: 'critChance', damage: 'critDamage' } });
    const [target, attacker] = [game.listening(1), game.listening(2)];

    game.set(attacker, 'critChance', 1);
    game.damage.hit({ target, attacker, amount: 15 });
    assert.equal(game.auras.has(attacker, game.id.frenzied), true);
    assert.equal(game.auras.has(target, game.id.bruised), true);
    assert.equal(game.auras.has(target, game.id.scorched), false);

    game.damage.hit({ target: attacker, amount: 5, kind: game.damage.kinds.id.fire });
    assert.equal(game.auras.has(attacker, game.id.scorched), true);
    assert.equal(game.auras.has(attacker, game.id.bruised), false);
  });

  it('answer a kill about the killer, and a heal about the healed unit', () => {
    const game = makeTriggerGame();
    const [target, killer] = [game.listening(1), game.listening(2)];

    killer.hp = 50;
    game.damage.hit({ target, attacker: killer, amount: 500 });
    game.damage.heal({ target: killer, amount: 4 });
    assert.equal(game.auras.has(killer, game.id.gorged), true);
    assert.equal(game.auras.has(killer, game.id.soothed), false);
    game.damage.heal({ target: killer, amount: 5 });
    assert.equal(game.auras.has(killer, game.id.soothed), true);
  });
});
