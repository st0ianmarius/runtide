import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { heal, setHealth } from '../../src/damage/index.ts';
import { applyAura, removeAura } from '../../src/procs/index.ts';
import { aura, KINDS, makeDamageGame } from '../helpers/damage-game.ts';

/** The test auras: an immunity to all but fire, two absorbs, a damage-taken scale, a death escape, a leech. */
const AURAS = {
  invulnerable: aura({
    duration: 'infinite',
    onIgnore: (_ctx, blow) => blow.kind !== KINDS.id.fire
  }),

  barrier: aura({
    duration: 10,
    value: 30,
    keepWhenDepleted: true,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) })
  }),

  ward: aura({
    duration: 10,
    value: 20,
    onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) })
  }),
  halve: aura({ duration: 10, onIncomingDamage: () => ({ scale: 0.5 }) }),
  escape: aura({
    duration: 10,
    onLethal: () => ({ prevent: true, procs: [setHealth({ share: 0.3 })] })
  }),
  leech: aura({ duration: 10, onDealt: (_ctx, blow) => [heal(blow.dealt / 2)] }),
  venom: aura({
    duration: 10,
    onDealt: (ctx) => (ctx.other === undefined ? undefined : [heal(1, { to: 'other' })])
  }),
  pledge: aura({
    duration: 10,
    value: 20,
    perSource: true,

    onIncomingDamage: (ctx, blow) =>
      ctx.aura.source === 2 ? { absorb: Math.min(ctx.aura.value, blow.amount) } : undefined
  }),
  executioner: aura({
    duration: 10,
    onOutgoingDamage: (_ctx, blow) => (blow.target.hp < 50 ? { scale: 2 } : undefined)
  })
} as const;

describe('the outgoing hook (onOutgoingDamage)', () => {
  it("changes the blows its bearer deals, reading the target, before the target's own stages", () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker] = [unit(1), unit(2)];

    auras.apply(attacker, id.executioner);
    auras.apply(target, id.halve);
    damage.hit({ target, attacker, amount: 20 });
    assert.equal(target.hp, 90);
    target.hp = 40;
    assert.equal(damage.hit({ target, attacker, amount: 20 }).amount, 20);
    assert.equal(damage.hit({ target, amount: 20 }).amount, 10);
  });
});

describe('the ignore stage (onIgnore)', () => {
  it('lets a blow pass its target by: health, events and every later blow stage untouched', () => {
    const { damage, auras, id, unit, bus, log } = makeDamageGame(AURAS);
    const target = unit(1);

    bus.on(bus.kind.taken, (event) => log.push(`taken ${event.blow?.status}`));
    auras.apply(target, id.invulnerable);

    const blow = damage.hit({ target, amount: 30 });

    assert.deepEqual([blow.status, blow.amount, target.hp], ['ignored', 0, 100]);
    assert.deepEqual(log, []);
  });

  it('is written by the hook against the blow: a kind only its own immunity stops passes', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.invulnerable);

    assert.equal(damage.hit({ target, amount: 30, kind: damage.kinds.id.fire }).status, 'landed');
    assert.equal(target.hp, 70);
  });
});

describe('absorbs (onIncomingDamage)', () => {
  it('take their amount out of the blow and spend the aura’s value by as much', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);

    const blow = damage.hit({ target, amount: 50 });

    assert.deepEqual([blow.status, blow.absorbed, blow.amount, target.hp], ['landed', 30, 20, 80]);
    assert.equal(auras.find(target, id.barrier)?.value, 0);
  });

  it('spend the value of the instance whose hook absorbed, not the first instance of the aura', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, { aura: id.pledge, source: 1, value: 10 });
    auras.apply(target, { aura: id.pledge, source: 2 });
    damage.hit({ target, amount: 5 });
    assert.deepEqual(
      auras.list(target).map((each) => [each.source, each.value]),
      [
        [1, 10],
        [2, 15]
      ]
    );
  });

  it('end a blow they ate whole `absorbed`, with nothing taken from health', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);

    const blow = damage.hit({ target, amount: 10 });

    assert.deepEqual([blow.status, blow.amount, blow.absorbed, target.hp], ['absorbed', 0, 10, 100]);
    assert.equal(auras.find(target, id.barrier)?.value, 20);
  });

  it('are spent one after another in registry order, and a depleted one goes unless it keeps', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.ward);
    auras.apply(target, id.barrier);
    damage.hit({ target, amount: 45 });

    assert.equal(auras.find(target, id.barrier)?.value, 0);
    assert.equal(auras.find(target, id.ward)?.value, 5);
    damage.hit({ target, amount: 10 });
    assert.equal(auras.has(target, id.ward), false);
    assert.equal(auras.has(target, id.barrier), true);
    assert.equal(target.hp, 95);
  });

  it('take no more than the value their instance holds, however much the hook asks; one with no value takes it all', () => {
    const { damage, auras, id, unit } = makeDamageGame({
      greedy: aura({ duration: 10, value: 20, onIncomingDamage: () => ({ absorb: 50 }) }),
      plating: aura({ duration: 10, onIncomingDamage: () => ({ absorb: 5 }) }),
      sink: aura({ duration: 10, value: 10, onIncomingHeal: () => ({ absorb: 50 }) })
    });

    const [target, plated, healed] = [unit(1), unit(2), unit(3)];

    auras.apply(target, id.greedy);

    const blow = damage.hit({ target, amount: 60 });

    assert.deepEqual([blow.absorbed, blow.amount, target.hp, auras.has(target, id.greedy)], [20, 40, 60, false]);

    auras.apply(plated, id.plating);
    damage.hit({ target: plated, amount: 30 });
    assert.deepEqual([damage.hit({ target: plated, amount: 30 }).absorbed, plated.hp], [5, 50]);

    healed.hp = 50;
    auras.apply(healed, id.sink);
    assert.deepEqual([damage.heal({ target: healed, amount: 30 }).absorbed, healed.hp], [10, 70]);
  });

  it('scale what is left', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.halve);

    const blow = damage.hit({ target, amount: 30 });

    assert.deepEqual([blow.amount, target.hp], [15, 85]);
  });

  it('are skipped by true damage, which keeps every point', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.barrier);
    damage.hit({ target, amount: 25, kind: damage.kinds.id.pure });
    assert.equal(target.hp, 75);
    assert.equal(auras.find(target, id.barrier)?.value, 30);
  });
});

describe('the lethal stage (onLethal)', () => {
  it('runs only for a blow that would kill, and a prevented death keeps the damage back and runs the hook’s procs', () => {
    const { damage, auras, id, unit, log } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.escape);
    damage.hit({ target, amount: 50 });
    assert.equal(target.hp, 50);

    const blow = damage.hit({ target, amount: 60 });

    assert.deepEqual(
      [blow.status, blow.isDeathPrevented, blow.prevented, blow.amount, blow.hasKilled],
      ['landed', true, 60, 0, false]
    );
    assert.equal(target.hp, 30);
    assert.deepEqual(log, []);
  });

  it('runs for true damage too', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const target = unit(1);

    auras.apply(target, id.escape);

    assert.equal(damage.hit({ target, amount: 500, kind: damage.kinds.id.pure }).isDeathPrevented, true);
    assert.equal(target.hp, 30);
  });
});

describe('the order of the incoming hooks', () => {
  it('runs reductions before absorbs by their incomingOrder, whatever their ids, and runs a change’s procs', () => {
    const { damage, auras, id, unit } = makeDamageGame({
      shield: aura({
        duration: 10,
        value: 20,
        incomingOrder: 1,
        onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) })
      }),
      stoneskin: aura({
        duration: 10,
        incomingOrder: -1,
        onIncomingDamage: () => ({ scale: 0.5 })
      }),
      link: aura({
        duration: 10,
        incomingOrder: 2,

        onIncomingDamage: (_ctx, blow) => ({
          scale: 0.5,
          procs: [heal(blow.amount / 2, { to: 'other' })]
        })
      })
    });

    const [target, attacker] = [unit(1), unit(2)];

    attacker.hp = 50;
    auras.apply(target, id.shield);
    auras.apply(target, id.stoneskin);
    auras.apply(target, id.link);
    assert.equal(damage.hit({ target, attacker, amount: 60 }).amount, 5);
    assert.equal(attacker.hp, 55);
    assert.throws(() => makeDamageGame({ bad: aura({ duration: 1, incomingOrder: Number.NaN }) }), /incomingOrder/);
  });
});

describe('a hook walk that removes and applies auras', () => {
  it('passes over an aura removed before its turn, even when an application in the walk would take its slot', () => {
    const seen: string[] = [];

    const game = makeDamageGame({
      shatter: aura({
        duration: 10,

        onIncomingDamage: () => ({
          procs: [removeAura('frozen', { to: 'self' }), applyAura('chilled', { to: 'other' })]
        })
      }),

      frozen: aura({
        duration: 10,

        onIncomingDamage: (ctx) => {
          seen.push(`frozen@${ctx.bearer.id}`);

          return { scale: 2 };
        }
      }),

      chilled: aura({
        duration: 10,

        onIncomingDamage: (ctx) => {
          seen.push(`chilled@${ctx.bearer.id}`);

          return { scale: 0 };
        }
      })
    });

    const [target, attacker] = [game.unit(1), game.unit(2)];

    game.auras.apply(target, game.id.shatter);
    game.auras.apply(target, game.id.frozen);

    const blow = game.damage.hit({ target, attacker, amount: 10 });

    assert.deepEqual([seen, blow.amount, game.auras.has(attacker, game.id.chilled)], [[], 10, true]);
  });
});

describe('the attacker’s onDealt hooks', () => {
  it('run after health for a blow that was dealt, their procs credited to the aura', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker] = [unit(1), unit(2)];

    attacker.hp = 50;
    auras.apply(attacker, id.leech);
    damage.hit({ target, attacker, amount: 30 });
    assert.equal(attacker.hp, 65);

    auras.apply(target, id.invulnerable);
    damage.hit({ target, attacker, amount: 30 });
    assert.equal(attacker.hp, 65);
  });

  it('name the blow’s target as the other unit, which their procs reach as `other`', () => {
    const { damage, auras, id, unit } = makeDamageGame(AURAS);
    const [target, attacker] = [unit(1), unit(2)];

    attacker.hp = 50;
    auras.apply(attacker, id.venom);
    damage.hit({ target, attacker, amount: 30 });
    assert.deepEqual([target.hp, attacker.hp], [71, 50]);
  });
});
